import { randomUUID } from "node:crypto";
import { many, one, run } from "./db.js";
import { evaluateWorkListForEmployee } from "./pmClient.js";
import { sendWorkListPush } from "./push.js";
import { activeFcmTokenForEmployee, FOUR_HOUR_KIND } from "./workListReminders.js";
import { shiftBounds } from "./time.js";

function nowIso(): string {
  return new Date().toISOString();
}

function pollMs(): number {
  const value = Number(process.env.WORK_LIST_JOB_POLL_MS ?? 30_000);
  return Number.isFinite(value) && value >= 5_000 ? value : 30_000;
}

function maxAttempts(): number {
  const value = Number(process.env.WORK_LIST_MAX_ATTEMPTS ?? 8);
  return Number.isFinite(value) && value >= 1 ? value : 8;
}

function backoffSeconds(attempt: number): number {
  return Math.min(15 * 60, Math.max(30, 30 * 2 ** Math.min(attempt, 6)));
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value == null ? "" : String(value);
}

async function markStatus(
  id: string,
  status: "SENT" | "SKIPPED" | "FAILED_TERMINAL" | "PENDING",
  extra: { skipReason?: string; errorCode?: string; nextAttemptAt?: string | null; attemptCount?: number } = {},
): Promise<void> {
  await run(
    `UPDATE work_list_reminders
     SET status = ?,
         skip_reason = COALESCE(?, skip_reason),
         last_error_code = COALESCE(?, last_error_code),
         next_attempt_at = ?,
         attempt_count = COALESCE(?, attempt_count),
         claim_token = NULL,
         updated_at = ?
     WHERE id = ?`,
    status,
    extra.skipReason ?? null,
    extra.errorCode ?? null,
    extra.nextAttemptAt === undefined ? null : extra.nextAttemptAt,
    extra.attemptCount ?? null,
    nowIso(),
    id,
  );
}

async function processReminder(row: Record<string, unknown>): Promise<void> {
  const id = text(row, "id");
  const employeeId = text(row, "employee_id");
  const sessionId = text(row, "session_id");
  const workDate = text(row, "work_date");
  const deliveryId = text(row, "delivery_id");
  const attemptCount = Number(row.attempt_count ?? 0);

  const session = await one("SELECT id, status FROM attendance_sessions WHERE id = ?", sessionId);
  if (!session || text(session, "status") !== "OPEN") {
    await markStatus(id, "SKIPPED", { skipReason: "SESSION_CLOSED" });
    return;
  }

  const assignment = await one(
    `SELECT a.work_date, t.start_time, t.end_time, w.timezone
     FROM shift_assignments a
     JOIN shift_templates t ON t.id = a.shift_template_id
     JOIN workplaces w ON w.id = a.workplace_id
     WHERE a.id = ?`,
    text(row, "assignment_id"),
  );
  if (assignment) {
    const bounds = shiftBounds(
      text(assignment, "work_date"),
      text(assignment, "start_time"),
      text(assignment, "end_time"),
      text(assignment, "timezone"),
    );
    if (Date.now() > bounds.endUtc.getTime() + 2 * 60 * 60 * 1000) {
      await markStatus(id, "SKIPPED", { skipReason: "WORKDAY_ENDED" });
      return;
    }
  }

  const employee = await one(
    `SELECT e.employee_code, u.email
     FROM employees e
     JOIN users u ON u.id = e.user_id
     WHERE e.id = ?`,
    employeeId,
  );
  if (!employee) {
    await markStatus(id, "FAILED_TERMINAL", { errorCode: "EMPLOYEE_MISSING" });
    return;
  }

  const evaluated = await evaluateWorkListForEmployee({
    workDate,
    employeeEmail: text(employee, "email"),
    employeeCode: text(employee, "employee_code"),
  });

  if (evaluated.status === "UPDATED") {
    await markStatus(id, "SKIPPED", { skipReason: evaluated.reason });
    await run(
      `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, detail, created_at)
       VALUES (?, NULL, 'WORK_LIST_SKIP', 'work_list_reminder', ?, ?, ?)`,
      randomUUID(),
      id,
      evaluated.reason,
      nowIso(),
    );
    return;
  }

  if (evaluated.status === "UNAVAILABLE") {
    const nextAttempt = attemptCount + 1;
    if (nextAttempt >= maxAttempts()) {
      await markStatus(id, "FAILED_TERMINAL", {
        errorCode: evaluated.reason,
        attemptCount: nextAttempt,
      });
      await run(
        `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, detail, created_at)
         VALUES (?, NULL, 'WORK_LIST_UNAVAILABLE', 'work_list_reminder', ?, ?, ?)`,
        randomUUID(),
        id,
        evaluated.reason,
        nowIso(),
      );
      return;
    }
    const nextAt = new Date(Date.now() + backoffSeconds(nextAttempt) * 1000).toISOString();
    await run(
      `UPDATE work_list_reminders
       SET status = 'PENDING',
           attempt_count = ?,
           next_attempt_at = ?,
           last_error_code = ?,
           claim_token = NULL,
           updated_at = ?
       WHERE id = ?`,
      nextAttempt,
      nextAt,
      evaluated.reason.slice(0, 64),
      nowIso(),
      id,
    );
    await run(
      `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, detail, created_at)
       VALUES (?, NULL, 'WORK_LIST_UNAVAILABLE', 'work_list_reminder', ?, ?, ?)`,
      randomUUID(),
      id,
      `${evaluated.reason}; retry ${nextAttempt}`,
      nowIso(),
    );
    return;
  }

  // PENDING — send push once
  const token = await activeFcmTokenForEmployee(employeeId);
  if (!token) {
    await markStatus(id, "SKIPPED", { skipReason: "NO_FCM_TOKEN", errorCode: "NO_FCM_TOKEN" });
    return;
  }
  const push = await sendWorkListPush({ fcmToken: token, deliveryId });
  if (!push.sent) {
    const nextAttempt = attemptCount + 1;
    if (nextAttempt >= maxAttempts() || push.errorCode === "FCM_NOT_CONFIGURED") {
      await markStatus(id, "FAILED_TERMINAL", {
        errorCode: push.errorCode ?? "FCM_SEND_FAILED",
        attemptCount: nextAttempt,
      });
      return;
    }
    const nextAt = new Date(Date.now() + backoffSeconds(nextAttempt) * 1000).toISOString();
    await run(
      `UPDATE work_list_reminders
       SET status = 'PENDING',
           attempt_count = ?,
           next_attempt_at = ?,
           last_error_code = ?,
           claim_token = NULL,
           updated_at = ?
       WHERE id = ?`,
      nextAttempt,
      nextAt,
      (push.errorCode ?? "FCM_SEND_FAILED").slice(0, 64),
      nowIso(),
      id,
    );
    return;
  }

  await markStatus(id, "SENT", { attemptCount: attemptCount + 1 });
  await run(
    `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, detail, created_at)
     VALUES (?, NULL, 'WORK_LIST_PUSH_SENT', 'work_list_reminder', ?, ?, ?)`,
    randomUUID(),
    id,
    deliveryId,
    nowIso(),
  );
}

async function claimDueReminders(): Promise<void> {
  const now = nowIso();
  const due = await many(
    `SELECT * FROM work_list_reminders
     WHERE kind = ?
       AND (
         (status = 'PENDING' AND due_at <= ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
         OR (status = 'CLAIMED' AND updated_at <= ?)
       )
     ORDER BY due_at ASC
     LIMIT 20`,
    FOUR_HOUR_KIND,
    now,
    now,
    new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  );

  for (const row of due) {
    const id = text(row, "id");
    const claimToken = randomUUID();
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await run(
      `UPDATE work_list_reminders
       SET status = 'CLAIMED', claim_token = ?, updated_at = ?
       WHERE id = ?
         AND (
           (status = 'PENDING' AND due_at <= ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
           OR (status = 'CLAIMED' AND updated_at <= ?)
         )`,
      claimToken,
      now,
      id,
      now,
      now,
      staleBefore,
    );
    const claimed = await one(
      "SELECT * FROM work_list_reminders WHERE id = ? AND claim_token = ? AND status = 'CLAIMED'",
      id,
      claimToken,
    );
    if (!claimed) continue;
    try {
      await processReminder(claimed as Record<string, unknown>);
    } catch (error) {
      console.error("work-list reminder failed:", error instanceof Error ? error.message : error);
      await run(
        `UPDATE work_list_reminders
         SET status = 'PENDING',
             claim_token = NULL,
             last_error_code = 'WORKER_EXCEPTION',
             next_attempt_at = ?,
             updated_at = ?
         WHERE id = ?`,
        new Date(Date.now() + 60_000).toISOString(),
        nowIso(),
        id,
      );
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startWorkListReminderWorker(): void {
  if (timer) return;
  const tick = () => {
    void claimDueReminders().catch((error) => {
      console.error("work-list worker tick failed:", error instanceof Error ? error.message : error);
    });
  };
  tick();
  timer = setInterval(tick, pollMs());
  if (typeof timer.unref === "function") timer.unref();
  console.log(`Work-list reminder worker polling every ${pollMs()}ms`);
}
