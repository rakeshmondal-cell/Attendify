export const WORK_LIST_MESSAGE = "Please fill the work list for the day.";

export type WorkListStatusKind = "UPDATED" | "PENDING" | "UNAVAILABLE";

export type PmUserRow = {
  employeeId?: unknown;
  email?: unknown;
  name?: unknown;
  openTaskCount?: unknown;
  progressUpdatedToday?: unknown;
  tasks?: unknown;
};

export type PmTasksResponse = {
  date?: unknown;
  workingDay?: unknown;
  users?: unknown;
};

/** PM portal wraps the payload as `{ success, data, error }`. Flat payloads are also accepted. */
export function unwrapPmTasksPayload(raw: unknown): { response: PmTasksResponse | null; error: string | null } {
  if (!raw || typeof raw !== "object") {
    return { response: null, error: "PM_PAYLOAD_INVALID" };
  }
  const body = raw as Record<string, unknown>;
  if ("success" in body || "data" in body) {
    if (body.success === false) {
      const err = body.error;
      const detail =
        typeof err === "string"
          ? err
          : err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "PM_SUCCESS_FALSE";
      return { response: null, error: detail.slice(0, 64) || "PM_SUCCESS_FALSE" };
    }
    const data = body.data;
    if (!data || typeof data !== "object") {
      return { response: null, error: "PM_DATA_MISSING" };
    }
    return { response: data as PmTasksResponse, error: null };
  }
  return { response: body as PmTasksResponse, error: null };
}

export type WorkListResolveInput = {
  workDate: string;
  employeeEmail: string;
  employeeCode: string;
  response: PmTasksResponse | null;
  fetchError?: string | null;
};

export type WorkListResolveResult = {
  status: WorkListStatusKind;
  reason: string;
  matched: boolean;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCode(value: string): string {
  return value.trim();
}

function pmRowEmployeeId(row: PmUserRow): string {
  return typeof row.employeeId === "string" || typeof row.employeeId === "number"
    ? normalizeCode(String(row.employeeId))
    : "";
}

/**
 * Match PM user to Attendify employee.
 * - If PM employeeId is set: require email + code.
 * - If PM employeeId is null/blank: email-only (handoff data blocker workaround).
 */
export function pmUserMatches(row: PmUserRow, employeeEmail: string, employeeCode: string): boolean {
  const rowEmail = typeof row.email === "string" ? normalizeEmail(row.email) : "";
  const email = normalizeEmail(employeeEmail);
  if (!rowEmail || rowEmail !== email) return false;
  const rowId = pmRowEmployeeId(row);
  if (!rowId) return true;
  return rowId === normalizeCode(employeeCode);
}

/** Pure matcher + status rules — unit-tested without HTTP. */
export function resolveWorkListStatus(input: WorkListResolveInput): WorkListResolveResult {
  if (input.fetchError || !input.response) {
    return { status: "UNAVAILABLE", reason: input.fetchError ?? "NO_RESPONSE", matched: false };
  }
  const body = input.response;
  const responseDate = typeof body.date === "string" ? body.date.trim() : "";
  if (responseDate !== input.workDate) {
    return { status: "UNAVAILABLE", reason: "DATE_MISMATCH", matched: false };
  }
  if (body.workingDay === false) {
    return { status: "UPDATED", reason: "NON_WORKING_DAY", matched: false };
  }
  if (body.workingDay !== true) {
    return { status: "UNAVAILABLE", reason: "WORKING_DAY_INVALID", matched: false };
  }
  if (!Array.isArray(body.users)) {
    return { status: "UNAVAILABLE", reason: "USERS_INVALID", matched: false };
  }

  const match = (body.users as PmUserRow[]).find((row) =>
    pmUserMatches(row, input.employeeEmail, input.employeeCode),
  );

  if (!match) {
    return { status: "UNAVAILABLE", reason: "EMPLOYEE_UNMATCHED", matched: false };
  }

  if (match.progressUpdatedToday === true) {
    return { status: "UPDATED", reason: "PROGRESS_UPDATED", matched: true };
  }
  if (match.progressUpdatedToday === false) {
    return { status: "PENDING", reason: "PROGRESS_PENDING", matched: true };
  }
  return { status: "UNAVAILABLE", reason: "PROGRESS_FLAG_INVALID", matched: true };
}

function pmConfigured(): boolean {
  return Boolean((process.env.PM_BASE_URL ?? "").trim());
}

/** Base URL of Project Control without trailing slash, or null when not configured. */
export function pmBaseUrl(): string | null {
  const base = (process.env.PM_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return base || null;
}

/** Same credentials used for the read API (bearer preferred, else X-API-Key). */
export function pmAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const bearer = (process.env.PM_BEARER_TOKEN ?? "").trim();
  const apiKey = (process.env.PM_API_KEY ?? "").trim();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  else if (apiKey) headers["X-API-Key"] = apiKey;
  return headers;
}

export function pmWebAppUrl(): string | null {
  const url = (process.env.PM_WEB_APP_URL ?? "").trim();
  return url || null;
}

export async function fetchPmAttendanceTasks(workDate: string): Promise<{
  response: PmTasksResponse | null;
  error: string | null;
}> {
  if (!pmConfigured()) {
    return { response: null, error: "PM_NOT_CONFIGURED" };
  }
  const base = (process.env.PM_BASE_URL ?? "").replace(/\/+$/, "");
  const timeoutMs = Math.max(1000, Number(process.env.WORK_LIST_PM_TIMEOUT_MS ?? 4000));
  const url = `${base}/api/integrations/attendance/tasks?date=${encodeURIComponent(workDate)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const bearer = (process.env.PM_BEARER_TOKEN ?? "").trim();
  const apiKey = (process.env.PM_API_KEY ?? "").trim();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  else if (apiKey) headers["X-API-Key"] = apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (!res.ok) {
      return { response: null, error: `PM_HTTP_${res.status}` };
    }
    const json = await res.json();
    return unwrapPmTasksPayload(json);
  } catch (error) {
    const code = error instanceof Error && error.name === "AbortError" ? "PM_TIMEOUT" : "PM_FETCH_FAILED";
    return { response: null, error: code };
  } finally {
    clearTimeout(timer);
  }
}

export async function evaluateWorkListForEmployee(input: {
  workDate: string;
  employeeEmail: string;
  employeeCode: string;
}): Promise<WorkListResolveResult & { message: string | null; pmWebUrl: string | null }> {
  const fetched = await fetchPmAttendanceTasks(input.workDate);
  const resolved = resolveWorkListStatus({
    workDate: input.workDate,
    employeeEmail: input.employeeEmail,
    employeeCode: input.employeeCode,
    response: fetched.response,
    fetchError: fetched.error,
  });
  return {
    ...resolved,
    message: resolved.status === "PENDING" ? WORK_LIST_MESSAGE : null,
    pmWebUrl: pmWebAppUrl(),
  };
}

export function findMatchedPmUser(
  response: PmTasksResponse | null,
  employeeEmail: string,
  employeeCode: string,
): PmUserRow | null {
  if (!response || !Array.isArray(response.users)) return null;
  return (
    (response.users as PmUserRow[]).find((row) => pmUserMatches(row, employeeEmail, employeeCode)) ??
    null
  );
}

export type WorkNoteEntry = {
  id: string;
  text: string;
  createdAt: string;
};

export type PmTaskSummary = {
  id: string | null;
  title: string;
  status: string | null;
  projectName: string | null;
  dueDate: string | null;
  workNote?: string | null;
  notes?: WorkNoteEntry[];
  /** False when Project Control took the task off this person (for example DONE came back as QA). */
  stillAssigned?: boolean | null;
  /** Created in Attendify and not yet confirmed by Project Control. */
  pendingPm?: boolean;
};

export type PmProjectSummary = {
  name: string;
  taskCount: number;
  openTaskCount: number;
};

/** Normalize PM task rows into Attendify-friendly summaries. */
export function mapPmUserWorkload(user: PmUserRow | null): {
  progressUpdatedToday: boolean | null;
  openTaskCount: number | null;
  projects: PmProjectSummary[];
  tasks: PmTaskSummary[];
} {
  if (!user) {
    return { progressUpdatedToday: null, openTaskCount: null, projects: [], tasks: [] };
  }
  const progressUpdatedToday =
    user.progressUpdatedToday === true ? true : user.progressUpdatedToday === false ? false : null;
  const openTaskCount =
    typeof user.openTaskCount === "number" && Number.isFinite(user.openTaskCount)
      ? user.openTaskCount
      : null;

  const tasks: PmTaskSummary[] = [];
  const projectCounts = new Map<string, { taskCount: number; openTaskCount: number }>();
  const rawTasks = Array.isArray(user.tasks) ? user.tasks : [];
  for (const item of rawTasks) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title =
      (typeof row.title === "string" && row.title.trim()) ||
      (typeof row.name === "string" && row.name.trim()) ||
      "Task";
    const status =
      typeof row.status === "string"
        ? row.status
        : typeof row.state === "string"
          ? row.state
          : null;
    const projectName =
      typeof row.projectName === "string"
        ? row.projectName
        : typeof row.project === "string"
          ? row.project
          : row.project && typeof row.project === "object" && typeof (row.project as { name?: unknown }).name === "string"
            ? String((row.project as { name: string }).name)
            : typeof row.projectCode === "string" && row.projectCode.trim()
              ? row.projectCode.trim()
              : "Assigned work";
    const dueDate =
      typeof row.dueDate === "string" ? row.dueDate : typeof row.due === "string" ? row.due : null;
    const rawId =
      typeof row.id === "string" || typeof row.id === "number" ? String(row.id) : null;
    const id = rawId ?? (typeof row.taskKey === "string" && row.taskKey.trim() ? row.taskKey.trim() : null);
    const open =
      status == null ||
      !/done|closed|complete|completed|cancelled/i.test(status);
    tasks.push({ id, title, status, projectName, dueDate, workNote: null });
    const bucket = projectCounts.get(projectName) ?? { taskCount: 0, openTaskCount: 0 };
    bucket.taskCount += 1;
    if (open) bucket.openTaskCount += 1;
    projectCounts.set(projectName, bucket);
  }

  const projects = [...projectCounts.entries()].map(([name, counts]) => ({
    name,
    taskCount: counts.taskCount,
    openTaskCount: counts.openTaskCount,
  }));

  if (projects.length === 0 && (openTaskCount ?? 0) > 0) {
    projects.push({ name: "Assigned work", taskCount: openTaskCount ?? 0, openTaskCount: openTaskCount ?? 0 });
  }

  return { progressUpdatedToday, openTaskCount, projects, tasks };
}

export type PmProgressEntry = {
  email: string;
  code: string;
  progressUpdatedToday: boolean | null;
  openTaskCount: number | null;
};

export function pmProgressByEmployee(response: PmTasksResponse | null): Map<string, PmProgressEntry> {
  const map = new Map<string, PmProgressEntry>();
  if (!response || !Array.isArray(response.users)) return map;
  for (const row of response.users as PmUserRow[]) {
    const email = typeof row.email === "string" ? normalizeEmail(row.email) : "";
    if (!email) continue;
    const code = pmRowEmployeeId(row);
    const progressUpdatedToday =
      row.progressUpdatedToday === true ? true : row.progressUpdatedToday === false ? false : null;
    const openTaskCount =
      typeof row.openTaskCount === "number" && Number.isFinite(row.openTaskCount)
        ? row.openTaskCount
        : null;
    const entry: PmProgressEntry = { email, code, progressUpdatedToday, openTaskCount };
    if (code) {
      map.set(`${code}|${email}`, entry);
    } else {
      // Email-only key only when PM employeeId is null/blank (same rule as pmUserMatches).
      map.set(`email|${email}`, entry);
    }
  }
  return map;
}

/** Prefer code+email; email-only fallback only for PM rows with blank employeeId. */
export function lookupPmProgress(
  map: Map<string, PmProgressEntry>,
  employeeCode: string,
  employeeEmail: string,
): PmProgressEntry | undefined {
  const email = normalizeEmail(employeeEmail);
  const code = normalizeCode(employeeCode);
  if (code) {
    const strict = map.get(`${code}|${email}`);
    if (strict) return strict;
  }
  const emailOnly = map.get(`email|${email}`);
  // Do not attribute coded PM rows via email alone (prevents false report matches).
  if (emailOnly && !emailOnly.code) return emailOnly;
  return undefined;
}
