import { randomUUID } from "node:crypto";
import { one, run } from "./db.js";

export const FOUR_HOUR_KIND = "FOUR_HOUR_PUSH";

function reminderHours(): number {
  const hours = Number(process.env.WORK_LIST_REMINDER_HOURS ?? 4);
  return Number.isFinite(hours) && hours > 0 ? hours : 4;
}

function plusHoursIso(iso: string, hours: number): string {
  const ms = new Date(iso).getTime() + hours * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Schedule once per employee+work_date. Duplicate inserts are ignored. */
export async function scheduleFourHourWorkListReminder(input: {
  employeeId: string;
  assignmentId: string;
  sessionId: string;
  workDate: string;
  checkInAt: string;
}): Promise<void> {
  const createdAt = nowIso();
  const dueAt = plusHoursIso(input.checkInAt, reminderHours());
  const id = randomUUID();
  const deliveryId = randomUUID();
  try {
    await run(
      `INSERT INTO work_list_reminders (
         id, employee_id, assignment_id, session_id, work_date, kind, due_at, status,
         attempt_count, next_attempt_at, last_error_code, delivery_id, claim_token, skip_reason,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, NULL, NULL, ?, NULL, NULL, ?, ?)`,
      id,
      input.employeeId,
      input.assignmentId,
      input.sessionId,
      input.workDate,
      FOUR_HOUR_KIND,
      dueAt,
      deliveryId,
      createdAt,
      createdAt,
    );
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "ER_DUP_ENTRY") return;
    throw error;
  }
}

export async function skipOpenWorkListReminders(input: {
  employeeId: string;
  workDate: string;
  reason: string;
}): Promise<void> {
  await run(
    `UPDATE work_list_reminders
     SET status = 'SKIPPED', skip_reason = ?, claim_token = NULL, updated_at = ?
     WHERE employee_id = ?
       AND work_date = ?
       AND kind = ?
       AND status IN ('PENDING', 'CLAIMED')`,
    input.reason.slice(0, 64),
    nowIso(),
    input.employeeId,
    input.workDate,
    FOUR_HOUR_KIND,
  );
}

export async function saveDeviceFcmToken(deviceId: string, token: string): Promise<void> {
  await run(
    `UPDATE devices SET fcm_token = ?, fcm_updated_at = ? WHERE id = ? AND status = 'ACTIVE'`,
    token.trim().slice(0, 4096),
    nowIso(),
    deviceId,
  );
}

export async function clearDeviceFcmToken(deviceId: string): Promise<void> {
  await run(`UPDATE devices SET fcm_token = NULL, fcm_updated_at = ? WHERE id = ?`, nowIso(), deviceId);
}

export async function activeFcmTokenForEmployee(employeeId: string): Promise<string | null> {
  const row = await one(
    `SELECT fcm_token FROM devices
     WHERE employee_id = ? AND status = 'ACTIVE' AND fcm_token IS NOT NULL AND fcm_token <> ''
     ORDER BY fcm_updated_at DESC, created_at DESC
     LIMIT 1`,
    employeeId,
  );
  if (!row) return null;
  const token = row.fcm_token;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}
