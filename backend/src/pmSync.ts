/**
 * Outbound sync: Attendify -> Project Control task updates.
 *
 * Changes wait in `pm_sync_outbox`. Delivery is OFF unless PM_WRITE_ENABLED=true.
 * POST {PM_BASE_URL}/api/integrations/attendance/task-updates
 * uses PM_WRITE_TOKEN (not the read token). Check-in and check-out are not accepted.
 * The live base URL is plain HTTP until Project Control enables HTTPS, so do not turn sending on
 * before that address and the write key are confirmed.
 */
import { randomUUID } from "node:crypto";
import { many, num, one, run, text } from "./db.js";
import { fetchPmAttendanceTasks, findMatchedPmUser, pmBaseUrl } from "./pmClient.js";

export type PmSyncKind = "TASK_UPDATE" | "ATTENDANCE" | "TASK_CREATE";

const DEFAULT_TASK_UPDATE_PATH = "/api/integrations/attendance/task-updates";
/** UNCONFIRMED placeholder. Project Control has not published a create endpoint yet. */
const DEFAULT_TASK_CREATE_PATH = "/api/integrations/attendance/tasks";
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

export function pmWriteEnabled(): boolean {
  return (process.env.PM_WRITE_ENABLED ?? "false").trim().toLowerCase() === "true";
}

/** Attendance reports stay queued until Project Control publishes their report endpoint. */
export function pmAttendanceWriteEnabled(): boolean {
  return (process.env.PM_ATTENDANCE_WRITE_ENABLED ?? "false").trim().toLowerCase() === "true";
}

/** New projects/tasks stay queued until Project Control publishes a create endpoint. */
export function pmTaskCreateEnabled(): boolean {
  return (process.env.PM_TASK_CREATE_ENABLED ?? "false").trim().toLowerCase() === "true";
}

function taskCreatePath(): string {
  const raw = (process.env.PM_TASK_CREATE_PATH ?? DEFAULT_TASK_CREATE_PATH).trim();
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function taskUpdatePath(): string {
  const raw = (process.env.PM_TASK_UPDATE_PATH ?? DEFAULT_TASK_UPDATE_PATH).trim();
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function attendanceReportPath(): string {
  const raw = (process.env.PM_ATTENDANCE_REPORT_PATH ?? "/api/integrations/attendance/reports").trim();
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/** Write key only. The read token must not authorize this POST. */
export function pmWriteAuthorization(): string | null {
  const token = (process.env.PM_WRITE_TOKEN ?? "").trim();
  return token ? `Bearer ${token}` : null;
}

function pollMs(): number {
  const value = Number(process.env.PM_SYNC_POLL_MS ?? 15_000);
  return Number.isFinite(value) && value >= 2_000 ? value : 15_000;
}

function maxAttempts(): number {
  const value = Number(process.env.PM_SYNC_MAX_ATTEMPTS ?? 20);
  return Number.isFinite(value) && value >= 1 ? value : 20;
}

function writeTimeoutMs(): number {
  const value = Number(process.env.PM_WRITE_TIMEOUT_MS ?? 8_000);
  return Number.isFinite(value) && value >= 1_000 ? value : 8_000;
}

export function backoffSeconds(attempt: number): number {
  return Math.min(30 * 60, Math.max(30, 30 * 2 ** Math.min(attempt, 7)));
}

const PASSTHROUGH_PM_STATUSES = new Set([
  "BACKLOG",
  "TO_DO",
  "IN_PROGRESS",
  "BLOCKED",
  "IN_REVIEW",
  "QA",
  "ON_HOLD",
  "CLOSED",
  "DONE",
]);

/** App labels (Open / In progress / Done) -> PM codes. Known PM codes pass through. */
export function normalizePmTaskStatus(raw: string): string {
  const cleaned = raw.trim().replace(/[\s-]+/g, "_").toUpperCase();
  if (cleaned === "OPEN" || cleaned === "TODO" || cleaned === "TO_DO") return "TO_DO";
  if (cleaned === "IN_PROGRESS" || cleaned === "INPROGRESS") return "IN_PROGRESS";
  if (cleaned === "DONE" || cleaned === "COMPLETED" || cleaned === "COMPLETE") return "DONE";
  if (PASSTHROUGH_PM_STATUSES.has(cleaned)) return cleaned;
  return cleaned || "TO_DO";
}

/** Progress is required for Project Control to count the daily update. */
export function progressForPmStatus(status: string): number {
  const code = normalizePmTaskStatus(status);
  if (code === "DONE" || code === "CLOSED") return 100;
  if (code === "IN_PROGRESS") return 50;
  return 0;
}

/** ISO 8601 with the IST offset Project Control asked for. */
export function formatIstTimestamp(iso: string): string {
  const parsed = new Date(iso);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}+05:30`;
}

/** Stable for retries of one payload. A new outbox version (new body) gets a new key. */
export function pmIdempotencyKey(outboxId: string, version: number): string {
  const key = `${outboxId}:v${version}`;
  if (key.length < 8) return key.padEnd(8, "0");
  return key.slice(0, 200);
}

/** Demo tasks must never be pushed to the real Project Control. */
export function isDummyTask(taskKey: string, projectName?: string | null): boolean {
  return taskKey.toLowerCase().startsWith("dummy-") || (projectName ?? "").startsWith("[DUMMY]");
}

export type PmAppliedTaskUpdate = {
  status: string | null;
  stillAssigned: boolean | null;
};

export type PmWriteResult = {
  ok: boolean;
  /** true = try again later; false (and !ok) = give up on this payload. */
  retryable: boolean;
  error: string | null;
  status: number | null;
  applied: PmAppliedTaskUpdate | null;
  /** Task key Project Control returned for a created task. */
  taskKey?: string | null;
};

/** `data.taskKey` from a create response, when present. */
export function readCreatedTaskKey(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const key = (data as { taskKey?: unknown }).taskKey;
  return typeof key === "string" && key.trim() ? key.trim().slice(0, 120) : null;
}

export function readAppliedTaskUpdate(body: unknown): PmAppliedTaskUpdate | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const row = data as { status?: unknown; stillAssigned?: unknown };
  const status = typeof row.status === "string" && row.status.trim() ? row.status.trim() : null;
  const stillAssigned = typeof row.stillAssigned === "boolean" ? row.stillAssigned : null;
  if (!status && stillAssigned === null) return null;
  return { status, stillAssigned };
}

/** Decide what an HTTP response from Project Control means for the outbox row. */
export function classifyPmWriteResponse(status: number, body: unknown): PmWriteResult {
  if (status >= 200 && status < 300) {
    if (body && typeof body === "object" && (body as { success?: unknown }).success === false) {
      const err = (body as { error?: unknown }).error;
      const code =
        typeof err === "string"
          ? err
          : err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
            ? String((err as { code: string }).code)
            : "REJECTED";
      return { ok: false, retryable: false, error: `PM_REJECTED_${code}`.slice(0, 160), status, applied: null };
    }
    return {
      ok: true,
      retryable: false,
      error: null,
      status,
      applied: readAppliedTaskUpdate(body),
      taskKey: readCreatedTaskKey(body),
    };
  }
  // 503 means write-back is switched off. Other 5xx, 408, and 429 are temporary.
  // 400, 401, 403, 404, 409, 413, and 422 are final.
  const retryable = status === 408 || status === 429 || status >= 500;
  return { ok: false, retryable, error: `PM_HTTP_${status}`, status, applied: null };
}

async function postPmJson(path: string, body: unknown, idempotencyKey: string): Promise<PmWriteResult> {
  const base = pmBaseUrl();
  if (!base) return { ok: false, retryable: true, error: "PM_NOT_CONFIGURED", status: null, applied: null };
  const authorization = pmWriteAuthorization();
  if (!authorization) {
    return { ok: false, retryable: false, error: "PM_WRITE_TOKEN_MISSING", status: null, applied: null };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), writeTimeoutMs());
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": idempotencyKey,
        Authorization: authorization,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return classifyPmWriteResponse(res.status, json);
  } catch (error) {
    const code = error instanceof Error && error.name === "AbortError" ? "PM_TIMEOUT" : "PM_FETCH_FAILED";
    return { ok: false, retryable: true, error: code, status: null, applied: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function postTaskUpdate(body: unknown, idempotencyKey: string): Promise<PmWriteResult> {
  return postPmJson(taskUpdatePath(), body, idempotencyKey);
}

export async function postAttendanceReport(body: unknown, idempotencyKey: string): Promise<PmWriteResult> {
  return postPmJson(attendanceReportPath(), body, idempotencyKey);
}

export async function postTaskCreate(body: unknown, idempotencyKey: string): Promise<PmWriteResult> {
  return postPmJson(taskCreatePath(), body, idempotencyKey);
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type TaskUpdatePayload = {
  email: string;
  employeeId?: string;
  workDate: string;
  taskKey: string;
  updatedAt: string;
  status: string;
  progress: number;
  workNote: string | null;
  appStatus: string;
  title: string | null;
  project: string | null;
};

export function buildTaskUpdatePayload(input: {
  email: string;
  employeeCode: string;
  /** Code Project Control already has for this person. Blank means omit employeeId. */
  pmEmployeeId?: string | null;
  workDate: string;
  taskKey: string;
  title?: string | null;
  projectName?: string | null;
  status: string;
  workNote?: string | null;
  updatedAt: string;
}): TaskUpdatePayload {
  const status = normalizePmTaskStatus(input.status);
  const pmCode = (input.pmEmployeeId ?? "").trim();
  const ours = input.employeeCode.trim();
  const payload: TaskUpdatePayload = {
    email: input.email.trim().toLowerCase(),
    workDate: input.workDate,
    taskKey: input.taskKey,
    updatedAt: input.updatedAt,
    status,
    progress: progressForPmStatus(status),
    workNote: (input.workNote ?? "").trim() || null,
    appStatus: input.status,
    title: (input.title ?? "").trim() || null,
    project: (input.projectName ?? "").trim() || null,
  };
  if (pmCode && pmCode.toUpperCase() === ours.toUpperCase()) payload.employeeId = pmCode;
  return payload;
}

/** Body actually posted. Drops a blank employeeId and stamps updatedAt in IST. */
export function pmTaskUpdateWireBody(payload: TaskUpdatePayload): Record<string, unknown> {
  const body: Record<string, unknown> = {
    email: payload.email,
    workDate: payload.workDate,
    taskKey: payload.taskKey,
    updatedAt: formatIstTimestamp(payload.updatedAt),
    status: payload.status,
    progress: payload.progress,
    appStatus: payload.appStatus,
  };
  if (payload.employeeId) body.employeeId = payload.employeeId;
  if (payload.title) body.title = payload.title;
  if (payload.project) body.project = payload.project;
  if (payload.workNote) body.workNote = payload.workNote;
  return body;
}

export type TaskCreatePayload = {
  email: string;
  employeeId?: string;
  workDate: string;
  /** Attendify's own key (NEW-xxxxxxxx). Project Control replies with the real task key. */
  localKey: string;
  projectName: string;
  title: string;
  status: string;
  progress: number;
  workNote: string | null;
  appStatus: string;
  createdAt: string;
};

export function buildTaskCreatePayload(input: {
  email: string;
  employeeCode: string;
  pmEmployeeId?: string | null;
  workDate: string;
  localKey: string;
  projectName: string;
  title: string;
  status: string;
  workNote?: string | null;
  createdAt: string;
}): TaskCreatePayload {
  const status = normalizePmTaskStatus(input.status);
  const pmCode = (input.pmEmployeeId ?? "").trim();
  const ours = input.employeeCode.trim();
  const payload: TaskCreatePayload = {
    email: input.email.trim().toLowerCase(),
    workDate: input.workDate,
    localKey: input.localKey,
    projectName: input.projectName.trim(),
    title: input.title.trim(),
    status,
    progress: progressForPmStatus(status),
    workNote: (input.workNote ?? "").trim() || null,
    appStatus: input.status,
    createdAt: input.createdAt,
  };
  if (pmCode && pmCode.toUpperCase() === ours.toUpperCase()) payload.employeeId = pmCode;
  return payload;
}

/** Body posted to the (not yet published) create endpoint. Times are IST. */
export function taskCreateWireBody(payload: TaskCreatePayload): Record<string, unknown> {
  const body: Record<string, unknown> = {
    email: payload.email,
    workDate: payload.workDate,
    clientKey: payload.localKey,
    project: payload.projectName,
    title: payload.title,
    status: payload.status,
    progress: payload.progress,
    appStatus: payload.appStatus,
    createdAt: formatIstTimestamp(payload.createdAt),
  };
  if (payload.employeeId) body.employeeId = payload.employeeId;
  if (payload.workNote) body.workNote = payload.workNote;
  return body;
}

export type AttendanceReportPayload = {
  email: string;
  employeeId?: string;
  workDate: string;
  sessionId: string;
  status: "OPEN" | "CLOSED";
  checkInAt: string;
  checkOutAt: string | null;
  netMinutes: number | null;
  workplace: string | null;
  updatedAt: string;
};

export function buildAttendanceReportPayload(input: {
  email: string;
  employeeCode: string;
  pmEmployeeId?: string | null;
  workDate: string;
  sessionId: string;
  status: string;
  checkInAt: string;
  checkOutAt?: string | null;
  netMinutes?: number | null;
  workplace?: string | null;
  updatedAt: string;
}): AttendanceReportPayload {
  const pmCode = (input.pmEmployeeId ?? "").trim();
  const ours = input.employeeCode.trim();
  const payload: AttendanceReportPayload = {
    email: input.email.trim().toLowerCase(),
    workDate: input.workDate,
    sessionId: input.sessionId,
    status: input.status === "CLOSED" ? "CLOSED" : "OPEN",
    checkInAt: input.checkInAt,
    checkOutAt: input.checkOutAt ?? null,
    netMinutes: input.netMinutes ?? null,
    workplace: (input.workplace ?? "").trim() || null,
    updatedAt: input.updatedAt,
  };
  if (pmCode && pmCode.toUpperCase() === ours.toUpperCase()) payload.employeeId = pmCode;
  return payload;
}

export function attendanceReportWireBody(payload: AttendanceReportPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {
    email: payload.email,
    workDate: payload.workDate,
    sessionId: payload.sessionId,
    status: payload.status,
    checkInAt: formatIstTimestamp(payload.checkInAt),
    checkOutAt: payload.checkOutAt ? formatIstTimestamp(payload.checkOutAt) : null,
    netMinutes: payload.netMinutes,
    workplace: payload.workplace,
    updatedAt: formatIstTimestamp(payload.updatedAt),
  };
  if (payload.employeeId) body.employeeId = payload.employeeId;
  return body;
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

async function upsertOutbox(input: {
  dedupeKey: string;
  kind: PmSyncKind;
  employeeId: string;
  workDate: string;
  payload: unknown;
}): Promise<void> {
  const stamp = nowIso();
  await run(
    `INSERT INTO pm_sync_outbox
       (id, dedupe_key, kind, employee_id, work_date, payload, version, status, attempt_count,
        next_attempt_at, last_error, sent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'PENDING', 0, NULL, NULL, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE
       payload = VALUES(payload),
       version = version + 1,
       status = 'PENDING',
       attempt_count = 0,
       next_attempt_at = NULL,
       last_error = NULL,
       sent_at = NULL,
       updated_at = VALUES(updated_at)`,
    randomUUID(),
    input.dedupeKey.slice(0, 190),
    input.kind,
    input.employeeId,
    input.workDate,
    JSON.stringify(input.payload),
    stamp,
    stamp,
  );
}

async function employeeIdentity(employeeId: string): Promise<{ email: string; employeeCode: string } | null> {
  const row = await one(
    `SELECT e.employee_code, u.email
     FROM employees e JOIN users u ON u.id = e.user_id
     WHERE e.id = ?`,
    employeeId,
  );
  if (!row) return null;
  return { email: text(row, "email"), employeeCode: text(row, "employee_code") };
}

/** Queue a task status / work-note change. Never throws (must not break the app action). */
export async function enqueueTaskUpdate(input: {
  employeeId: string;
  workDate: string;
  taskKey: string;
  title?: string | null;
  projectName?: string | null;
  status: string;
  workNote?: string | null;
  updatedAt: string;
}): Promise<void> {
  try {
    if (isDummyTask(input.taskKey, input.projectName)) return;
    if (input.taskKey.startsWith(LOCAL_TASK_PREFIX)) {
      // Project Control does not know this task yet, so a task-update would be refused (404).
      await refreshPendingCreate(input);
      return;
    }
    const who = await employeeIdentity(input.employeeId);
    if (!who) return;
    const noteRows = await many(
      `SELECT id, body, created_at
       FROM work_task_note_entries
       WHERE employee_id = ? AND work_date = ? AND task_key = ?
       ORDER BY created_at ASC, id ASC`,
      input.employeeId,
      input.workDate,
      input.taskKey,
    );
    const latestNote = [...noteRows]
      .reverse()
      .map((row) => String(row.body ?? "").trim())
      .find((note) => note && note.toLowerCase() !== "null");
    const pmEmployeeId = await matchingPmEmployeeId(who.email, who.employeeCode, input.workDate);
    const payload = buildTaskUpdatePayload({
      ...who,
      ...input,
      workNote: input.workNote ?? latestNote ?? null,
      pmEmployeeId,
    });
    await upsertOutbox({
      dedupeKey: `task:${input.employeeId}:${input.workDate}:${input.taskKey}`,
      kind: "TASK_UPDATE",
      employeeId: input.employeeId,
      workDate: input.workDate,
      payload,
    });
  } catch (error) {
    console.error("pm-sync enqueue task failed:", error instanceof Error ? error.message : error);
  }
}

const LOCAL_TASK_PREFIX = "NEW-";

function optionalString(value: unknown): string | null {
  if (value == null) return null;
  const textValue = String(value).trim();
  return textValue ? textValue : null;
}

function createDedupeKey(employeeId: string, taskKey: string): string {
  return `create:${employeeId}:${taskKey}`;
}

/** Queue a project/task the person added in Attendify. Never throws. */
export async function enqueueTaskCreate(input: {
  employeeId: string;
  workDate: string;
  taskKey: string;
  projectName: string;
  title: string;
  status: string;
  workNote?: string | null;
  createdAt: string;
}): Promise<void> {
  try {
    const who = await employeeIdentity(input.employeeId);
    if (!who) return;
    const payload = buildTaskCreatePayload({
      ...who,
      workDate: input.workDate,
      localKey: input.taskKey,
      projectName: input.projectName,
      title: input.title,
      status: input.status,
      workNote: input.workNote ?? null,
      createdAt: input.createdAt,
      pmEmployeeId: await matchingPmEmployeeId(who.email, who.employeeCode, input.workDate),
    });
    await upsertOutbox({
      dedupeKey: createDedupeKey(input.employeeId, input.taskKey),
      kind: "TASK_CREATE",
      employeeId: input.employeeId,
      workDate: input.workDate,
      payload,
    });
  } catch (error) {
    console.error("pm-sync enqueue create failed:", error instanceof Error ? error.message : error);
  }
}

/** A status or note changed on a task Project Control has not seen yet: refresh the pending create. */
async function refreshPendingCreate(input: {
  employeeId: string;
  taskKey: string;
  status: string;
  workNote?: string | null;
  updatedAt: string;
}): Promise<void> {
  const created = await one(
    `SELECT project_name, title, created_work_date, created_at
     FROM work_created_tasks WHERE employee_id = ? AND task_key = ?`,
    input.employeeId,
    input.taskKey,
  );
  if (!created) return;
  const existing = await one(
    "SELECT status FROM pm_sync_outbox WHERE dedupe_key = ?",
    createDedupeKey(input.employeeId, input.taskKey),
  );
  // Already delivered (key may be unknown). Do not create a second copy in Project Control.
  if (existing && text(existing, "status") === "SENT") return;
  const noteRows = await many(
    `SELECT body FROM work_task_note_entries
     WHERE employee_id = ? AND task_key = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    input.employeeId,
    input.taskKey,
  );
  const latestNote = noteRows.length > 0 ? String(noteRows[0].body ?? "").trim() : "";
  await enqueueTaskCreate({
    employeeId: input.employeeId,
    workDate: text(created, "created_work_date"),
    taskKey: input.taskKey,
    projectName: text(created, "project_name"),
    title: text(created, "title"),
    status: input.status,
    workNote: input.workNote ?? (latestNote || null),
    createdAt: text(created, "created_at"),
  });
}

/** Replace Attendify's key with the key Project Control returned, everywhere it is stored. */
export async function applyCreatedTaskKey(
  employeeId: string,
  localKey: string,
  pmKey: string,
): Promise<void> {
  await run(
    "UPDATE work_created_tasks SET pm_task_key = ? WHERE employee_id = ? AND task_key = ?",
    pmKey,
    employeeId,
    localKey,
  );
  if (pmKey === localKey) return;
  await run(
    "UPDATE IGNORE work_task_updates SET task_key = ? WHERE employee_id = ? AND task_key = ?",
    pmKey,
    employeeId,
    localKey,
  );
  await run(
    "UPDATE work_task_note_entries SET task_key = ? WHERE employee_id = ? AND task_key = ?",
    pmKey,
    employeeId,
    localKey,
  );
}

/** Queue one attendance report per session. Check-out refreshes the same row. */
export async function enqueueAttendance(sessionId: string): Promise<void> {
  try {
    const row = await one(
      `SELECT s.id, s.employee_id, s.check_in_at, s.check_out_at, s.net_minutes, s.status,
              a.work_date, w.name AS workplace_name, e.employee_code, u.email
       FROM attendance_sessions s
       JOIN shift_assignments a ON a.id = s.assignment_id
       JOIN workplaces w ON w.id = s.workplace_id
       JOIN employees e ON e.id = s.employee_id
       JOIN users u ON u.id = e.user_id
       WHERE s.id = ?`,
      sessionId,
    );
    if (!row) return;
    const email = text(row, "email");
    const employeeCode = text(row, "employee_code");
    const workDate = text(row, "work_date");
    const payload = buildAttendanceReportPayload({
      email,
      employeeCode,
      pmEmployeeId: await matchingPmEmployeeId(email, employeeCode, workDate),
      workDate,
      sessionId,
      status: text(row, "status"),
      checkInAt: text(row, "check_in_at"),
      checkOutAt: row.check_out_at == null ? null : String(row.check_out_at),
      netMinutes: row.net_minutes == null ? null : num(row, "net_minutes"),
      workplace: row.workplace_name == null ? null : String(row.workplace_name),
      updatedAt: nowIso(),
    });
    await upsertOutbox({
      dedupeKey: `attendance:${sessionId}`,
      kind: "ATTENDANCE",
      employeeId: text(row, "employee_id"),
      workDate,
      payload,
    });
  } catch (error) {
    console.error("pm-sync enqueue attendance failed:", error instanceof Error ? error.message : error);
  }
}

/** Include employeeId only when Project Control already stores the same code. */
async function matchingPmEmployeeId(
  email: string,
  employeeCode: string,
  workDate: string,
): Promise<string | null> {
  if (!pmBaseUrl()) return null;
  const fetched = await fetchPmAttendanceTasks(workDate);
  const matched = findMatchedPmUser(fetched.response, email, employeeCode);
  if (!matched) return null;
  const raw = matched.employeeId;
  const pmCode = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
  if (!pmCode || pmCode.toUpperCase() !== employeeCode.trim().toUpperCase()) return null;
  return pmCode;
}

async function finishRow(
  id: string,
  version: number,
  outcome: {
    status: "SENT" | "PENDING" | "FAILED_TERMINAL" | "SKIPPED";
    attemptCount: number;
    nextAttemptAt?: string | null;
    error?: string | null;
  },
): Promise<void> {
  const stamp = nowIso();
  // `version` guard: if the row was updated again while we were sending, keep it PENDING.
  await run(
    `UPDATE pm_sync_outbox
     SET status = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?, sent_at = ?, updated_at = ?
     WHERE id = ? AND version = ?`,
    outcome.status,
    outcome.attemptCount,
    outcome.nextAttemptAt ?? null,
    outcome.error ?? null,
    outcome.status === "SENT" ? stamp : null,
    stamp,
    id,
    version,
  );
}

async function applyReturnedTaskStatus(
  employeeId: string,
  payload: TaskUpdatePayload,
  applied: PmAppliedTaskUpdate | null,
): Promise<void> {
  if (!applied?.status && applied?.stillAssigned == null) return;
  const status = applied?.status ?? payload.status;
  const stillAssigned = applied?.stillAssigned;
  await run(
    `UPDATE work_task_updates
     SET status = ?, pm_still_assigned = ?, updated_at = ?
     WHERE employee_id = ? AND work_date = ? AND task_key = ?`,
    status,
    stillAssigned == null ? null : stillAssigned ? 1 : 0,
    nowIso(),
    employeeId,
    payload.workDate,
    payload.taskKey,
  );
}

export type OutboxRunSummary = { sent: number; retried: number; failed: number; skipped: boolean };

let running = false;

/** One delivery pass. Exported for the worker and for tests. */
export async function processOutboxOnce(): Promise<OutboxRunSummary> {
  const summary: OutboxRunSummary = { sent: 0, retried: 0, failed: 0, skipped: false };
  const kinds: PmSyncKind[] = [];
  if (pmWriteEnabled()) kinds.push("TASK_UPDATE");
  if (pmAttendanceWriteEnabled()) kinds.push("ATTENDANCE");
  if (pmTaskCreateEnabled()) kinds.push("TASK_CREATE");
  if (!pmBaseUrl() || kinds.length === 0) {
    summary.skipped = true;
    return summary;
  }
  if (running) {
    summary.skipped = true;
    return summary;
  }
  running = true;
  try {
    const now = nowIso();
    const staleBefore = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const due = await many(
      `SELECT * FROM pm_sync_outbox
       WHERE kind IN (${kinds.map(() => "?").join(", ")})
         AND (
           (status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
           OR (status = 'SENDING' AND updated_at <= ?)
         )
       ORDER BY created_at ASC
       LIMIT 20`,
      ...kinds,
      now,
      staleBefore,
    );
    for (const row of due) {
      const id = text(row, "id");
      const version = num(row, "version");
      const attemptCount = num(row, "attempt_count");
      const kind = text(row, "kind") as PmSyncKind;
      await run(
        "UPDATE pm_sync_outbox SET status = 'SENDING', updated_at = ? WHERE id = ? AND version = ?",
        nowIso(),
        id,
        version,
      );
      try {
        const payload = JSON.parse(text(row, "payload")) as TaskUpdatePayload &
          AttendanceReportPayload &
          TaskCreatePayload;
        const idemKey = pmIdempotencyKey(id, version);
        const result =
          kind === "ATTENDANCE"
            ? await postAttendanceReport(attendanceReportWireBody(payload), idemKey)
            : kind === "TASK_CREATE"
              ? await postTaskCreate(taskCreateWireBody(payload), idemKey)
              : await postTaskUpdate(pmTaskUpdateWireBody(payload), idemKey);
        if (result.ok) {
          const current = await one("SELECT version FROM pm_sync_outbox WHERE id = ?", id);
          const unchanged = Boolean(current && num(current, "version") === version);
          if (unchanged && kind === "TASK_UPDATE") {
            await applyReturnedTaskStatus(text(row, "employee_id"), payload, result.applied);
          }
          if (kind === "TASK_CREATE") {
            const employeeId = text(row, "employee_id");
            // If Project Control gave no key, keep Attendify's own key and mark it as delivered.
            const pmKey = result.taskKey ?? payload.localKey;
            await applyCreatedTaskKey(employeeId, payload.localKey, pmKey);
            if (!unchanged) {
              // A newer status or note was queued while this was sending. It is now a normal update.
              await run("UPDATE pm_sync_outbox SET status = 'SENT', sent_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), id);
              const latest = await one(
                `SELECT title, status, project_name, work_note, work_date
                 FROM work_task_updates WHERE employee_id = ? AND task_key = ?
                 ORDER BY updated_at DESC LIMIT 1`,
                employeeId,
                pmKey,
              );
              if (latest && pmKey !== payload.localKey) {
                await enqueueTaskUpdate({
                  employeeId,
                  workDate: text(latest, "work_date"),
                  taskKey: pmKey,
                  title: optionalString(latest.title),
                  projectName: optionalString(latest.project_name),
                  status: text(latest, "status"),
                  workNote: optionalString(latest.work_note),
                  updatedAt: nowIso(),
                });
              }
              summary.sent += 1;
              console.log(`pm-sync sent TASK_CREATE ${id} key=${pmKey}`);
              continue;
            }
          }
          await finishRow(id, version, { status: "SENT", attemptCount: attemptCount + 1 });
          summary.sent += 1;
          console.log(`pm-sync sent ${kind} ${id} status=${result.applied?.status ?? payload.status}`);
          continue;
        }
        const nextAttempt = attemptCount + 1;
        if (!result.retryable || nextAttempt >= maxAttempts()) {
          await finishRow(id, version, {
            status: "FAILED_TERMINAL",
            attemptCount: nextAttempt,
            error: result.error,
          });
          summary.failed += 1;
          console.warn(`pm-sync gave up on ${kind} ${id}: ${result.error}`);
        } else {
          await finishRow(id, version, {
            status: "PENDING",
            attemptCount: nextAttempt,
            nextAttemptAt: new Date(Date.now() + backoffSeconds(nextAttempt) * 1000).toISOString(),
            error: result.error,
          });
          summary.retried += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN";
        await finishRow(id, version, {
          status: "PENDING",
          attemptCount: attemptCount + 1,
          nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
          error: `WORKER_EXCEPTION ${message}`.slice(0, 160),
        });
        summary.retried += 1;
      }
    }
  } finally {
    running = false;
  }
  return summary;
}

export async function pmSyncSummary(): Promise<Record<string, number>> {
  const rows = await many("SELECT status, COUNT(*) AS n FROM pm_sync_outbox GROUP BY status");
  const out: Record<string, number> = {};
  for (const row of rows) out[text(row, "status")] = num(row, "n");
  return out;
}

let timer: NodeJS.Timeout | null = null;

export function startPmSyncWorker(): void {
  if (timer) return;
  if (!pmWriteEnabled()) {
    console.log("PM task write-back is OFF. Leave it off until the HTTPS address and PM_WRITE_TOKEN are confirmed.");
  }
  if (!pmAttendanceWriteEnabled()) {
    console.log("PM attendance reports are queued only. Sending stays off until Project Control accepts them.");
  }
  if (!pmTaskCreateEnabled()) {
    console.log("PM new-project requests are queued only. Sending stays off until Project Control publishes a create endpoint.");
  }
  const tick = () => {
    void processOutboxOnce().catch((error) => {
      console.error("pm-sync tick failed:", error instanceof Error ? error.message : error);
    });
  };
  timer = setInterval(tick, pollMs());
  if (typeof timer.unref === "function") timer.unref();
  console.log(`PM sync worker polling every ${pollMs()}ms (enabled=${pmWriteEnabled()})`);
}
