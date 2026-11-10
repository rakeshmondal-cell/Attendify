import {
  createHash,
  createPublicKey,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { many, num, one, optionalNum, optionalText, run, text, transaction, type SqlRow } from "./db.js";
import {
  mailConfigured,
  sendAppPasscodeEmail,
  sendHrAlertEmail,
  sendOtpEmail,
  sendPasscodeChangedEmail,
} from "./mail.js";
import { evaluateWorkListForEmployee, pmWebAppUrl, WORK_LIST_MESSAGE } from "./pmClient.js";
import {
  addDays,
  arrivalStatus,
  departureStatus,
  formatDateLabel,
  formatDuration,
  formatTimeInZone,
  greetingFor,
  netMinutesBetween,
  shiftBounds,
  todayInZone,
} from "./time.js";
import { saveDeviceFcmToken, scheduleFourHourWorkListReminder, skipOpenWorkListReminders } from "./workListReminders.js";

const OTP_MINUTES = 5;
const OTP_RESEND_SECONDS = 45;
const ACTIVATION_MINUTES = 15;
const DEVICE_PROOF_MINUTES = 10;
const CHALLENGE_MINUTES = 5;
const SESSION_HOURS = 12;
const MAX_OTP_ATTEMPTS = 5;
const MAX_PASSCODE_ATTEMPTS = 5;
const PASSCODE_LOCK_MINUTES = 15;
const POOR_GPS_METERS = 100;
const PASSCODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const showOtpInResponse =
  process.env.ATTENDIFY_SHOW_OTP === "true" ||
  (process.env.ATTENDIFY_SHOW_OTP !== "false" && process.env.NODE_ENV !== "production");

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type AuthUser = {
  id: string;
  email: string;
  role: "ADMIN" | "EMPLOYEE";
  status: string;
};

export type SessionContext = {
  user: AuthUser;
  employeeId: string | null;
  deviceId: string | null;
  sessionId: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function plusMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60000).toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function generateAppPasscode(): string {
  const bytes = randomBytes(8);
  let raw = "";
  for (let i = 0; i < 8; i++) raw += PASSCODE_ALPHABET[bytes[i]! % PASSCODE_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function hashPasscode(passcode: string, salt: string): string {
  return scryptSync(passcode.normalize("NFKC"), salt, 64).toString("hex");
}

/** Canonical form for new passcodes: letters/digits only (hyphens/spaces ignored). */
function normalizePasscode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Pre-change form that kept hyphens — still accepted when verifying older hashes. */
function legacyNormalizePasscode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function passcodeMatches(raw: string, salt: string, expected: string): boolean {
  const modern = hashPasscode(normalizePasscode(raw), salt);
  if (hashesMatch(expected, modern)) return true;
  const legacy = legacyNormalizePasscode(raw);
  if (legacy === normalizePasscode(raw)) return false;
  return hashesMatch(expected, hashPasscode(legacy, salt));
}

function assertChosenPasscode(raw: string): string {
  const normalized = normalizePasscode(raw);
  if (normalized.length < 6 || normalized.length > 16) {
    throw new HttpError(400, "PASSCODE_WEAK", "Choose a passcode with 6 to 16 letters or digits.");
  }
  return normalized;
}

async function userByEmail(email: string): (AuthUser & { created_at: string }) | undefined {
  const row = await one("SELECT * FROM users WHERE email = ?", email);
  if (!row) return undefined;
  return {
    id: text(row, "id"),
    email: text(row, "email"),
    role: text(row, "role") as AuthUser["role"],
    status: text(row, "status"),
    created_at: text(row, "created_at"),
  };
}

async function employeeByUserId(userId: string): SqlRow | undefined {
  return await one("SELECT * FROM employees WHERE user_id = ?", userId);
}

async function audit(actorUserId: string | null, action: string, entityType: string, entityId: string | null, detail: string): void {
  await run(
    "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    randomUUID(),
    actorUserId,
    action,
    entityType,
    entityId,
    detail,
    nowIso(),
  );
}

export async function seed(): void {
  const createdAt = nowIso();
  if (!await one("SELECT id FROM users WHERE id = ?", "user-hr-admin")) {
    await run(
      "INSERT INTO users (id, email, role, status, created_at) VALUES (?, ?, 'ADMIN', 'ACTIVE', ?)",
      "user-hr-admin",
      "hr@attendify.local",
      createdAt,
    );
  }
  // Named roles: Mithun = HR (web admin), Joydeep = Manager (team approvals).
  const mithun = await one(
    `SELECT u.id FROM users u
     WHERE u.email = 'mithun_roy@msrlimited.com'
        OR u.id IN (SELECT user_id FROM employees WHERE employee_code = 'MSR827' OR full_name LIKE 'Mithun%')
     LIMIT 1`,
  );
  if (mithun) {
    await run("UPDATE users SET role = 'ADMIN', status = 'ACTIVE' WHERE id = ?", text(mithun, "id"));
  }
  const joydeep = await one(
    `SELECT id FROM employees
     WHERE employee_code = 'MSR443' OR full_name LIKE 'Joydeep%'
     ORDER BY created_at ASC LIMIT 1`,
  );
  if (joydeep) {
    await run("UPDATE employees SET is_manager = 0 WHERE id <> ?", text(joydeep, "id"));
    await run("UPDATE employees SET is_manager = 1, manager_id = NULL WHERE id = ?", text(joydeep, "id"));
    await run(
      `UPDATE employees
       SET manager_id = ?
       WHERE id <> ?
         AND (manager_id IS NULL OR manager_id <> ?)`,
      text(joydeep, "id"),
      text(joydeep, "id"),
      text(joydeep, "id"),
    );
  }
  if (!await one("SELECT id FROM workplaces WHERE id = ?", "wp-head-office")) {
    await run(
      `INSERT INTO workplaces (id, name, timezone, latitude, longitude, radius_meters)
       VALUES (?, 'Head Office', 'Asia/Kolkata', 22.5726, 88.3639, 150)`,
      "wp-head-office",
    );
  }
  const shifts: Array<[string, string, string, string, number]> = [
    ["shift-general", "General shift", "09:00", "18:00", 10],
    ["shift-morning", "Morning shift", "08:00", "16:00", 10],
    ["shift-evening", "Evening shift", "16:00", "00:00", 10],
    ["shift-night", "Night shift", "00:00", "08:00", 10],
  ];
  for (const [id, name, start, end, grace] of shifts) {
    if (!await one("SELECT id FROM shift_templates WHERE id = ?", id)) {
      await run(
        "INSERT INTO shift_templates (id, name, start_time, end_time, grace_minutes) VALUES (?, ?, ?, ?, ?)",
        id,
        name,
        start,
        end,
        grace,
      );
    }
  }
  await syncOrgCatalogFromEmployees();
}

async function ensureCatalogName(table: "departments" | "designations", nameRaw: string): Promise<string> {
  const name = nameRaw.trim();
  if (!name) throw new HttpError(400, "INVALID_NAME", "Enter a name.");
  const existing = await one(`SELECT id, name FROM ${table} WHERE name = ?`, name);
  if (existing) return text(existing, "name");
  await run(
    `INSERT INTO ${table} (id, name, created_at) VALUES (?, ?, ?)`,
    randomUUID(),
    name,
    nowIso(),
  );
  return name;
}

async function syncOrgCatalogFromEmployees(): Promise<void> {
  const departments = await many("SELECT DISTINCT department AS name FROM employees WHERE department IS NOT NULL AND department <> ''");
  for (const row of departments) await ensureCatalogName("departments", text(row, "name"));
  const designations = await many("SELECT DISTINCT designation AS name FROM employees WHERE designation IS NOT NULL AND designation <> ''");
  for (const row of designations) await ensureCatalogName("designations", text(row, "name"));
}

async function listCatalog(table: "departments" | "designations") {
  return (await many(`SELECT id, name FROM ${table} ORDER BY name`)).map((row) => ({
    id: text(row, "id"),
    name: text(row, "name"),
  }));
}

export async function createDepartment(session: SessionContext, name: string) {
  requireAdmin(session);
  const saved = await ensureCatalogName("departments", name);
  await audit(session.user.id, "DEPARTMENT_CREATED", "department", null, saved);
  return { name: saved, departments: await listCatalog("departments") };
}

export async function createDesignation(session: SessionContext, name: string) {
  requireAdmin(session);
  const saved = await ensureCatalogName("designations", name);
  await audit(session.user.id, "DESIGNATION_CREATED", "designation", null, saved);
  return { name: saved, designations: await listCatalog("designations") };
}

async function issueOtp(email: string, purpose: string): Promise<{
  challengeId: string;
  code: string;
  mailed: boolean;
  mailError?: string;
  devCode?: string;
}> {
  const recent = await one(
    `SELECT created_at FROM otp_challenges
     WHERE email = ? AND purpose = ?
     ORDER BY created_at DESC LIMIT 1`,
    email,
    purpose,
  );
  if (recent) {
    const elapsedMs = Date.now() - new Date(text(recent, "created_at")).getTime();
    if (Number.isFinite(elapsedMs) && elapsedMs < OTP_RESEND_SECONDS * 1000) {
      const wait = Math.ceil((OTP_RESEND_SECONDS * 1000 - elapsedMs) / 1000);
      throw new HttpError(429, "OTP_COOLDOWN", `Wait ${wait} seconds before requesting another code.`);
    }
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const id = randomUUID();
  const createdAt = nowIso();
  await run("UPDATE otp_challenges SET consumed_at = ? WHERE email = ? AND purpose = ? AND consumed_at IS NULL", createdAt, email, purpose);
  await run(
    `INSERT INTO otp_challenges (id, email, purpose, code_hash, expires_at, attempts, consumed_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`,
    id,
    email,
    purpose,
    sha256(`${id}:${code}`),
    plusMinutes(OTP_MINUTES),
    createdAt,
  );

  let mailed = false;
  let mailError: string | undefined;
  if (mailConfigured()) {
    try {
      await sendOtpEmail(email, purpose, code);
      mailed = true;
    } catch (error) {
      mailError = error instanceof Error ? error.message : "Email could not be sent.";
      console.error("OTP email failed:", mailError);
      if (process.env.NODE_ENV === "production" && process.env.ATTENDIFY_SHOW_OTP !== "true") {
        throw new HttpError(502, "MAIL_FAILED", "The verification email could not be sent. Try again shortly.");
      }
    }
  } else if (process.env.NODE_ENV === "production") {
    throw new HttpError(500, "MAIL_NOT_CONFIGURED", "Email delivery is not configured.");
  }

  return {
    challengeId: id,
    code,
    mailed,
    mailError,
    devCode: showOtpInResponse ? code : undefined,
  };
}

async function assertLoginDevice(userId: string, deviceIdRaw: string | undefined): Promise<string> {
  const deviceId = deviceIdRaw?.trim() ?? "";
  if (!deviceId) {
    throw new HttpError(400, "DEVICE_REQUIRED", "Activate this phone with your work email first.");
  }
  const employee = await employeeByUserId(userId);
  if (!employee) throw new HttpError(404, "ACCOUNT_NOT_FOUND", "No employee profile found for this email.");
  const device = await one(
    `SELECT id, status FROM devices WHERE id = ? AND employee_id = ?`,
    deviceId,
    text(employee, "id"),
  );
  if (!device || text(device, "status") !== "ACTIVE") {
    throw new HttpError(
      403,
      "DEVICE_MISMATCH",
      "This phone is not registered for that email. Activate again or ask HR to reset the device.",
    );
  }
  return deviceId;
}

export type OtpPurpose = "ACTIVATION" | "LOGIN" | "RECOVERY" | "WEB" | "PASSCODE_RECOVERY";

export async function requestOtp(
  emailRaw: string,
  purpose: OtpPurpose,
  deviceProof?: string,
  deviceId?: string,
): Promise<{ mailed: boolean; message: string; devCode?: string }> {
  const email = emailRaw.trim().toLowerCase();
  if (purpose === "LOGIN") {
    throw new HttpError(410, "LOGIN_OTP_RETIRED", "Update Attendify. Unlock with fingerprint or your app passcode.");
  }

  const user = await userByEmail(email);
  if (purpose === "WEB") {
    if (!user || user.role !== "ADMIN" || user.status !== "ACTIVE") {
      throw new HttpError(404, "ACCOUNT_NOT_FOUND", "No active HR account matches this email.");
    }
  } else if (purpose === "PASSCODE_RECOVERY") {
    // Privacy-safe: always look like success path messaging after cooldown checks for real accounts.
    if (!user || user.role !== "EMPLOYEE" || user.status !== "ACTIVE") {
      return { mailed: true, message: "If this email is registered on this phone, a recovery code was sent." };
    }
    const employee = await employeeByUserId(user.id);
    if (!employee || !deviceId) {
      return { mailed: true, message: "If this email is registered on this phone, a recovery code was sent." };
    }
    const device = await one(
      `SELECT id, status, setup_status FROM devices WHERE id = ? AND employee_id = ?`,
      deviceId,
      text(employee, "id"),
    );
    if (!device || text(device, "status") !== "ACTIVE") {
      return { mailed: true, message: "If this email is registered on this phone, a recovery code was sent." };
    }
  } else if (!user || user.role !== "EMPLOYEE" || user.status !== "ACTIVE") {
    throw new HttpError(404, "ACCOUNT_NOT_FOUND", "No active employee account matches this email. Contact HR.");
  }

  if (purpose === "LOGIN" && deviceProof) {
    // unreachable — kept for type exhaustiveness
  }

  const issued = await issueOtp(email, purpose);
  const message = purpose === "PASSCODE_RECOVERY"
    ? "If this email is registered on this phone, a recovery code was sent."
    : issued.mailed
      ? "A verification code was sent to your work email."
      : issued.mailError
        ? "Email delivery failed. Use the on-screen code if shown, or try again."
        : "Enter the verification code.";
  return {
    mailed: issued.mailed || purpose === "PASSCODE_RECOVERY",
    message,
    devCode: issued.devCode,
  };
}

export async function verifyOtp(
  emailRaw: string,
  purpose: OtpPurpose,
  code: string,
  deviceProof?: string,
  deviceId?: string,
): Promise<Record<string, unknown>> {
  if (purpose === "LOGIN") {
    throw new HttpError(410, "LOGIN_OTP_RETIRED", "Update Attendify. Unlock with fingerprint or your app passcode.");
  }
  const email = emailRaw.trim().toLowerCase();
  const row = await one(
    `SELECT * FROM otp_challenges
     WHERE email = ? AND purpose = ? AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    email,
    purpose,
  );
  if (!row) throw new HttpError(400, "OTP_INVALID", "That code is not valid. Request a new one.");
  if (text(row, "expires_at") < nowIso()) {
    throw new HttpError(400, "OTP_EXPIRED", "That code has expired. Request a new one.");
  }
  if (num(row, "attempts") >= MAX_OTP_ATTEMPTS) {
    throw new HttpError(400, "OTP_LOCKED", "Too many attempts. Request a new code.");
  }
  const expected = text(row, "code_hash");
  const actual = sha256(`${text(row, "id")}:${code.trim()}`);
  if (!hashesMatch(expected, actual)) {
    await run("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?", text(row, "id"));
    throw new HttpError(400, "OTP_INVALID", "That code is not valid.");
  }
  await run("UPDATE otp_challenges SET consumed_at = ? WHERE id = ?", nowIso(), text(row, "id"));
  const user = await userByEmail(email);
  if (!user || user.status !== "ACTIVE") {
    throw new HttpError(403, "ACCOUNT_INACTIVE", "This account is not active.");
  }

  if (purpose === "ACTIVATION") {
    const token = randomToken();
    const tokenId = randomUUID();
    await run(
      `INSERT INTO tokens (id, user_id, kind, token_hash, device_id, expires_at, used_at, created_at)
       VALUES (?, ?, 'ACTIVATION', ?, NULL, ?, NULL, ?)`,
      tokenId,
      user.id,
      sha256(token),
      plusMinutes(ACTIVATION_MINUTES),
      nowIso(),
    );
    return { activationToken: token };
  }

  if (purpose === "PASSCODE_RECOVERY") {
    if (!deviceId) throw new HttpError(400, "DEVICE_REQUIRED", "Open recovery from the registered phone.");
    const employee = await employeeByUserId(user.id);
    if (!employee) throw new HttpError(404, "ACCOUNT_NOT_FOUND", "Employee profile not found.");
    const device = await one(
      `SELECT * FROM devices WHERE id = ? AND employee_id = ? AND status = 'ACTIVE'`,
      deviceId,
      text(employee, "id"),
    );
    if (!device) throw new HttpError(403, "DEVICE_MISMATCH", "This phone is not registered for that email.");
    const ticket = randomToken();
    await run(
      `INSERT INTO tokens (id, user_id, kind, token_hash, device_id, expires_at, used_at, created_at)
       VALUES (?, ?, 'PASSCODE_RESET', ?, ?, ?, NULL, ?)`,
      randomUUID(),
      user.id,
      sha256(ticket),
      deviceId,
      plusMinutes(ACTIVATION_MINUTES),
      nowIso(),
    );
    return {
      resetTicket: ticket,
      message: "Email verified. A new app passcode will be emailed next.",
    };
  }

  if (purpose === "RECOVERY") {
    const employee = await employeeByUserId(user.id);
    const activeDevices = employee
      ? await many("SELECT id, label FROM devices WHERE employee_id = ? AND status = 'ACTIVE'", text(employee, "id"))
      : [];
    await audit(user.id, "RECOVERY_REQUESTED", "employee", employee ? text(employee, "id") : null, "Employee confirmed email for device recovery.");
    return {
      recovery: true,
      activeDeviceCount: activeDevices.length,
      message: "Continue setup with your work email on this phone.",
    };
  }

  const session = await createSession(user.id, null);
  return await sessionResponse(session.token, user.id);
}

export async function completeLogin(
  loginTicketRaw: string,
  deviceProofRaw: string,
): Promise<Record<string, unknown>> {
  const ticket = await requireToken(loginTicketRaw, "LOGIN_TICKET");
  const proof = await requireToken(deviceProofRaw, "DEVICE_PROOF");
  if (proof.userId !== ticket.userId) {
    throw new HttpError(403, "EMAIL_MISMATCH", "Fingerprint does not match this sign-in.");
  }
  if (!ticket.deviceId || proof.deviceId !== ticket.deviceId) {
    throw new HttpError(403, "DEVICE_MISMATCH", "Use the phone that requested this sign-in.");
  }
  const session = await createSession(ticket.userId, ticket.deviceId);
  await run("UPDATE tokens SET used_at = ? WHERE id = ?", nowIso(), ticket.id);
  await run("UPDATE tokens SET used_at = ? WHERE id = ?", nowIso(), proof.id);
  await audit(ticket.userId, "LOGIN_COMPLETED", "device", ticket.deviceId, "Signed in with email OTP + fingerprint.");
  return await sessionResponse(session.token, ticket.userId);
}

async function notifyHrDeviceChange(input: {
  employeeName: string;
  employeeCode: string;
  email: string;
  previousLabel: string | null;
  newLabel: string;
}): Promise<void> {
  const admins = await many("SELECT email FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
  const recipients = admins.map((row) => text(row, "email"));
  if (recipients.length === 0) return;
  const body = [
    "Attendify device change alert",
    "",
    `Employee: ${input.employeeName} (${input.employeeCode})`,
    `Email: ${input.email}`,
    `Previous phone: ${input.previousLabel ?? "None"}`,
    `New phone: ${input.newLabel}`,
    `Time: ${nowIso()}`,
    "",
    "The employee verified their work email and registered a new phone. No HR reset was required.",
  ].join("\n");
  if (!mailConfigured()) {
    console.warn("HR device-change alert (mail not configured):\n" + body);
    return;
  }
  try {
    await sendHrAlertEmail(recipients, `Attendify: ${input.employeeName} changed phone`, body);
  } catch (error) {
    console.error("HR device-change email failed:", error instanceof Error ? error.message : error);
  }
}

async function requireToken(raw: string, kind: string): { id: string; userId: string; deviceId: string | null } {
  if (!raw) throw new HttpError(401, "TOKEN_REQUIRED", "Sign in again to continue.");
  const row = await one("SELECT * FROM tokens WHERE token_hash = ? AND kind = ?", sha256(raw), kind);
  if (!row || row.used_at || text(row, "expires_at") < nowIso()) {
    throw new HttpError(401, "TOKEN_EXPIRED", "This step has expired. Start again.");
  }
  return { id: text(row, "id"), userId: text(row, "user_id"), deviceId: optionalText(row, "device_id") };
}

async function createSession(userId: string, deviceId: string | null): { token: string; sessionId: string } {
  const token = randomToken();
  const sessionId = randomUUID();
  await run(
    `INSERT INTO sessions (id, user_id, device_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    sessionId,
    userId,
    deviceId,
    sha256(token),
    new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString(),
    nowIso(),
  );
  return { token, sessionId };
}

async function sessionResponse(token: string, userId: string): Record<string, unknown> {
  const user = (await one("SELECT * FROM users WHERE id = ?", userId))!;
  const employee = await employeeByUserId(userId);
  return {
    token,
    role: text(user, "role"),
    email: text(user, "email"),
    employee: employee ? employeeSummary(employee) : null,
  };
}

export async function readSession(token: string | undefined): SessionContext {
  if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const row = await one("SELECT * FROM sessions WHERE token_hash = ?", sha256(token));
  if (!row || text(row, "expires_at") < nowIso()) {
    throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  const userRow = await one("SELECT * FROM users WHERE id = ?", text(row, "user_id"));
  if (!userRow || text(userRow, "status") !== "ACTIVE") {
    throw new HttpError(403, "ACCOUNT_INACTIVE", "This account is not active.");
  }
  const employee = await employeeByUserId(text(userRow, "id"));
  return {
    sessionId: text(row, "id"),
    deviceId: optionalText(row, "device_id"),
    employeeId: employee ? text(employee, "id") : null,
    user: {
      id: text(userRow, "id"),
      email: text(userRow, "email"),
      role: text(userRow, "role") as AuthUser["role"],
      status: text(userRow, "status"),
    },
  };
}

export async function logout(token: string | undefined): void {
  if (!token) return;
  await run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
}

export async function registerDevice(
  activationToken: string,
  publicKeySpki: string,
  label: string,
  biometricBound: boolean,
): Promise<{ deviceId: string; deviceChanged: boolean; previousLabel: string | null }> {
  const token = await requireToken(activationToken, "ACTIVATION");
  const employee = await employeeByUserId(token.userId);
  if (!employee) throw new HttpError(403, "NOT_EMPLOYEE", "This account cannot register a phone.");
  const user = await one("SELECT email FROM users WHERE id = ?", token.userId);
  try {
    createPublicKey({ key: Buffer.from(publicKeySpki, "base64"), format: "der", type: "spki" });
  } catch {
    throw new HttpError(400, "INVALID_KEY", "The phone key could not be read. Try activation again.");
  }
  const employeeId = text(employee, "id");
  const previous = await many(
    "SELECT id, label FROM devices WHERE employee_id = ? AND status = 'ACTIVE'",
    employeeId,
  );
  const previousLabel = previous[0] ? text(previous[0], "label") : null;
  const deviceChanged = previous.length > 0;
  if (deviceChanged) {
    await run("UPDATE devices SET status = 'REVOKED' WHERE employee_id = ? AND status = 'ACTIVE'", employeeId);
  }
  if (!biometricBound) {
    throw new HttpError(400, "BIOMETRIC_REQUIRED", "Fingerprint setup is required on this phone.");
  }
  const deviceId = randomUUID();
  const newLabel = label.trim().slice(0, 80) || "Android phone";
  await run(
    `INSERT INTO devices (
       id, employee_id, public_key_spki, label, biometric_bound, status,
       passcode_hash, passcode_salt, passcode_version, failed_passcode_attempts,
       passcode_locked_until, setup_status, pending_passcode_hash, created_at
     ) VALUES (?, ?, ?, ?, 1, 'ACTIVE', NULL, NULL, 0, 0, NULL, 'PENDING_PASSCODE_EMAIL', NULL, ?)`,
    deviceId,
    employeeId,
    publicKeySpki,
    newLabel,
    nowIso(),
  );
  await audit(
    token.userId,
    deviceChanged ? "DEVICE_CHANGED" : "DEVICE_REGISTERED",
    "device",
    deviceId,
    deviceChanged
      ? `Replaced ${previousLabel ?? "previous phone"} with ${newLabel}`
      : "Biometric-bound device key registered; awaiting passcode email.",
  );
  if (deviceChanged) {
    await notifyHrDeviceChange({
      employeeName: text(employee, "full_name"),
      employeeCode: text(employee, "employee_code"),
      email: user ? text(user, "email") : "",
      previousLabel,
      newLabel,
    });
  }
  return { deviceId, deviceChanged, previousLabel, setupStatus: "PENDING_PASSCODE_EMAIL" as const };
}

export async function completeActivation(activationToken: string, deviceId: string): Promise<Record<string, unknown>> {
  // Legacy path — prefer finalizeSetup so the passcode email is sent.
  return await finalizeSetup(activationToken, deviceId);
}

async function assertActiveEmployeeDevice(deviceId: string): Promise<{ device: SqlRow; employee: SqlRow; user: SqlRow }> {
  const device = await one("SELECT * FROM devices WHERE id = ?", deviceId);
  if (!device || text(device, "status") !== "ACTIVE") {
    throw new HttpError(403, "DEVICE_REVOKED", "This phone is not registered. Complete setup again.");
  }
  const employee = await one("SELECT * FROM employees WHERE id = ?", text(device, "employee_id"));
  if (!employee) throw new HttpError(404, "NOT_FOUND", "Employee not found.");
  const user = await one("SELECT * FROM users WHERE id = ?", text(employee, "user_id"));
  if (!user || text(user, "status") !== "ACTIVE" || text(user, "role") !== "EMPLOYEE") {
    throw new HttpError(403, "ACCOUNT_INACTIVE", "This account is not active.");
  }
  return { device, employee, user };
}

export async function finalizeSetup(activationToken: string, deviceId: string): Promise<Record<string, unknown>> {
  const token = await requireToken(activationToken, "ACTIVATION");
  const { device, employee, user } = await assertActiveEmployeeDevice(deviceId);
  if (text(employee, "user_id") !== token.userId) {
    throw new HttpError(403, "FORBIDDEN", "This setup token does not match the phone.");
  }

  const setupStatus = optionalText(device, "setup_status") ?? "PENDING_PASSCODE_EMAIL";
  if (setupStatus === "READY" && optionalText(device, "passcode_hash")) {
    const session = await createSession(token.userId, deviceId);
    await run("UPDATE tokens SET used_at = ?, device_id = ? WHERE id = ?", nowIso(), deviceId, token.id);
    return {
      ...(await sessionResponse(session.token, token.userId)),
      setupStatus: "READY",
      passcodeEmailed: false,
      message: "Setup already complete.",
    };
  }

  const passcode = generateAppPasscode();
  const salt = randomBytes(16).toString("hex");
  const digest = hashPasscode(normalizePasscode(passcode), salt);
  const version = num(device, "passcode_version") + 1;

  let mailed = false;
  let mailError: string | undefined;
  if (mailConfigured()) {
    try {
      await sendAppPasscodeEmail(text(user, "email"), passcode, "setup");
      mailed = true;
    } catch (error) {
      mailError = error instanceof Error ? error.message : "Email could not be sent.";
      console.error("App passcode email failed:", mailError);
    }
  } else if (showOtpInResponse) {
    mailed = false;
  } else if (process.env.NODE_ENV === "production") {
    throw new HttpError(500, "MAIL_NOT_CONFIGURED", "Email delivery is not configured.");
  }

  if (!mailed && !showOtpInResponse && process.env.NODE_ENV === "production") {
    await run(
      `UPDATE devices
       SET passcode_salt = ?, pending_passcode_hash = ?, passcode_version = ?, setup_status = 'PENDING_PASSCODE_EMAIL'
       WHERE id = ?`,
      salt,
      digest,
      version,
      deviceId,
    );
    throw new HttpError(502, "MAIL_FAILED", "The passcode email could not be sent. Tap retry.");
  }

  await run(
    `UPDATE devices
     SET passcode_hash = ?, passcode_salt = ?, passcode_version = ?, pending_passcode_hash = NULL,
         failed_passcode_attempts = 0, passcode_locked_until = NULL, setup_status = 'READY'
     WHERE id = ?`,
    digest,
    salt,
    version,
    deviceId,
  );
  await run("UPDATE tokens SET used_at = ?, device_id = ? WHERE id = ?", nowIso(), deviceId, token.id);
  const session = await createSession(token.userId, deviceId);
  await audit(token.userId, "SETUP_FINALIZED", "device", deviceId, "Passcode issued and setup marked READY.");
  return {
    ...(await sessionResponse(session.token, token.userId)),
    setupStatus: "READY",
    passcodeEmailed: mailed,
    // Dev-only: never log; only return when ATTENDIFY_SHOW_OTP is enabled.
    devPasscode: showOtpInResponse ? passcode : undefined,
    message: mailed
      ? "Your app passcode was emailed. Unlock with fingerprint next time."
      : "Setup complete. Check the on-screen passcode if email is not configured.",
  };
}

export async function unlockWithBiometric(deviceProofRaw: string): Promise<Record<string, unknown>> {
  const proof = await requireToken(deviceProofRaw, "DEVICE_PROOF");
  if (!proof.deviceId) throw new HttpError(400, "DEVICE_REQUIRED", "Fingerprint unlock needs a registered phone.");
  const { device, user } = await assertActiveEmployeeDevice(proof.deviceId);
  if (text(user, "id") !== proof.userId) {
    throw new HttpError(403, "EMAIL_MISMATCH", "Fingerprint does not match this account.");
  }
  if ((optionalText(device, "setup_status") ?? "") !== "READY" || !optionalText(device, "passcode_hash")) {
    throw new HttpError(409, "SETUP_REQUIRED", "Complete fingerprint and passcode setup on this phone.");
  }
  await run("UPDATE tokens SET used_at = ? WHERE id = ?", nowIso(), proof.id);
  const session = await createSession(proof.userId, proof.deviceId);
  await audit(proof.userId, "UNLOCK_BIOMETRIC", "device", proof.deviceId, "Unlocked with fingerprint.");
  return await sessionResponse(session.token, proof.userId);
}

export async function unlockWithPasscode(deviceId: string, passcodeRaw: string): Promise<Record<string, unknown>> {
  const { device, user } = await assertActiveEmployeeDevice(deviceId);
  if ((optionalText(device, "setup_status") ?? "") !== "READY" || !optionalText(device, "passcode_hash")) {
    throw new HttpError(409, "SETUP_REQUIRED", "Complete setup on this phone first.");
  }
  const lockedUntil = optionalText(device, "passcode_locked_until");
  if (lockedUntil && lockedUntil > nowIso()) {
    throw new HttpError(429, "PASSCODE_LOCKED", "Too many incorrect passcodes. Try again later.");
  }
  const salt = optionalText(device, "passcode_salt");
  const expected = optionalText(device, "passcode_hash");
  if (!salt || !expected) throw new HttpError(409, "SETUP_REQUIRED", "Complete setup on this phone first.");
  if (!passcodeMatches(passcodeRaw, salt, expected)) {
    const attempts = num(device, "failed_passcode_attempts") + 1;
    const lock = attempts >= MAX_PASSCODE_ATTEMPTS ? plusMinutes(PASSCODE_LOCK_MINUTES) : null;
    await run(
      `UPDATE devices SET failed_passcode_attempts = ?, passcode_locked_until = ? WHERE id = ?`,
      attempts >= MAX_PASSCODE_ATTEMPTS ? 0 : attempts,
      lock,
      deviceId,
    );
    throw new HttpError(401, "PASSCODE_INVALID", "That passcode is not correct.");
  }
  await run(
    `UPDATE devices SET failed_passcode_attempts = 0, passcode_locked_until = NULL WHERE id = ?`,
    deviceId,
  );
  const session = await createSession(text(user, "id"), deviceId);
  await audit(text(user, "id"), "UNLOCK_PASSCODE", "device", deviceId, "Unlocked with app passcode.");
  return await sessionResponse(session.token, text(user, "id"));
}

export async function changeAppPasscode(
  session: SessionContext,
  currentPasscodeRaw: string,
  newPasscodeRaw: string,
): Promise<Record<string, unknown>> {
  const actor = await requireEmployee(session);
  const device = await one("SELECT * FROM devices WHERE id = ? AND status = 'ACTIVE'", actor.deviceId);
  if (!device || text(device, "employee_id") !== actor.employeeId) {
    throw new HttpError(403, "DEVICE_REVOKED", "This phone was reset by HR. Activate it again.");
  }
  if ((optionalText(device, "setup_status") ?? "") !== "READY" || !optionalText(device, "passcode_hash")) {
    throw new HttpError(409, "SETUP_REQUIRED", "Complete setup on this phone first.");
  }
  const lockedUntil = optionalText(device, "passcode_locked_until");
  if (lockedUntil && lockedUntil > nowIso()) {
    throw new HttpError(429, "PASSCODE_LOCKED", "Too many incorrect passcodes. Try again later.");
  }
  const salt = optionalText(device, "passcode_salt");
  const expected = optionalText(device, "passcode_hash");
  if (!salt || !expected) throw new HttpError(409, "SETUP_REQUIRED", "Complete setup on this phone first.");

  if (!passcodeMatches(currentPasscodeRaw, salt, expected)) {
    const attempts = num(device, "failed_passcode_attempts") + 1;
    const lock = attempts >= MAX_PASSCODE_ATTEMPTS ? plusMinutes(PASSCODE_LOCK_MINUTES) : null;
    await run(
      `UPDATE devices SET failed_passcode_attempts = ?, passcode_locked_until = ? WHERE id = ?`,
      attempts >= MAX_PASSCODE_ATTEMPTS ? 0 : attempts,
      lock,
      actor.deviceId,
    );
    throw new HttpError(401, "PASSCODE_INVALID", "That passcode is not correct.");
  }

  const next = assertChosenPasscode(newPasscodeRaw);
  const currentCompact = normalizePasscode(currentPasscodeRaw);
  if (next === currentCompact) {
    throw new HttpError(400, "PASSCODE_UNCHANGED", "Choose a new passcode that is different from the current one.");
  }

  const newSalt = randomBytes(16).toString("hex");
  const digest = hashPasscode(next, newSalt);
  const version = num(device, "passcode_version") + 1;
  await run(
    `UPDATE devices
     SET passcode_hash = ?, passcode_salt = ?, passcode_version = ?, pending_passcode_hash = NULL,
         failed_passcode_attempts = 0, passcode_locked_until = NULL, setup_status = 'READY'
     WHERE id = ?`,
    digest,
    newSalt,
    version,
    actor.deviceId,
  );
  await audit(session.user.id, "PASSCODE_CHANGED", "device", actor.deviceId, "Employee chose a new app passcode.");

  if (mailConfigured()) {
    try {
      await sendPasscodeChangedEmail(session.user.email);
    } catch (error) {
      console.error("Passcode-changed confirmation email failed:", error instanceof Error ? error.message : error);
    }
  }

  return {
    changed: true,
    message: "Your app passcode was updated. Use the new passcode next time fingerprint unlock fails.",
  };
}

export async function requestPasscodeReset(emailRaw: string, deviceId: string): Promise<{ mailed: boolean; message: string; devCode?: string }> {
  return await requestOtp(emailRaw, "PASSCODE_RECOVERY", undefined, deviceId);
}

export async function verifyPasscodeReset(
  emailRaw: string,
  code: string,
  deviceId: string,
): Promise<Record<string, unknown>> {
  const verified = await verifyOtp(emailRaw, "PASSCODE_RECOVERY", code, undefined, deviceId);
  const resetTicket = String(verified.resetTicket ?? "");
  if (!resetTicket) throw new HttpError(500, "RESET_FAILED", "Could not start passcode reset.");
  return await completePasscodeReset(resetTicket);
}

export async function completePasscodeReset(resetTicketRaw: string): Promise<Record<string, unknown>> {
  const ticket = await requireToken(resetTicketRaw, "PASSCODE_RESET");
  if (!ticket.deviceId) throw new HttpError(400, "DEVICE_REQUIRED", "Reset from the registered phone.");
  const { device, user } = await assertActiveEmployeeDevice(ticket.deviceId);
  if (text(user, "id") !== ticket.userId) {
    throw new HttpError(403, "FORBIDDEN", "Reset ticket does not match this phone.");
  }

  const passcode = generateAppPasscode();
  const salt = randomBytes(16).toString("hex");
  const digest = hashPasscode(normalizePasscode(passcode), salt);
  const version = num(device, "passcode_version") + 1;

  let mailed = false;
  if (mailConfigured()) {
    try {
      await sendAppPasscodeEmail(text(user, "email"), passcode, "reset");
      mailed = true;
    } catch (error) {
      console.error("Passcode reset email failed:", error instanceof Error ? error.message : error);
      throw new HttpError(502, "MAIL_FAILED", "The new passcode email could not be sent. Try again.");
    }
  } else if (!showOtpInResponse) {
    throw new HttpError(500, "MAIL_NOT_CONFIGURED", "Email delivery is not configured.");
  }

  await run(
    `UPDATE devices
     SET passcode_hash = ?, passcode_salt = ?, passcode_version = ?, pending_passcode_hash = NULL,
         failed_passcode_attempts = 0, passcode_locked_until = NULL, setup_status = 'READY'
     WHERE id = ?`,
    digest,
    salt,
    version,
    ticket.deviceId,
  );
  await run("UPDATE tokens SET used_at = ? WHERE id = ?", nowIso(), ticket.id);
  await audit(ticket.userId, "PASSCODE_RESET", "device", ticket.deviceId, "App passcode rotated after recovery OTP.");
  return {
    reset: true,
    passcodeEmailed: mailed,
    unlocked: false,
    message: "A new app passcode was emailed. Enter it to unlock — the recovery code alone cannot unlock the app.",
    devPasscode: showOtpInResponse ? passcode : undefined,
  };
}

export async function deviceAuthStatus(deviceId: string, emailRaw: string): Promise<Record<string, unknown>> {
  const email = emailRaw.trim().toLowerCase();
  const device = await one("SELECT * FROM devices WHERE id = ?", deviceId);
  if (!device || text(device, "status") !== "ACTIVE") {
    return { registered: false, setupStatus: null, needsSetup: true };
  }
  const employee = await one("SELECT * FROM employees WHERE id = ?", text(device, "employee_id"));
  const user = employee ? await one("SELECT * FROM users WHERE id = ?", text(employee, "user_id")) : undefined;
  if (!user || text(user, "email") !== email || text(user, "status") !== "ACTIVE") {
    return { registered: false, setupStatus: null, needsSetup: true };
  }
  const setupStatus = optionalText(device, "setup_status") ?? "NEEDS_SETUP";
  const ready = setupStatus === "READY" && Boolean(optionalText(device, "passcode_hash"));
  return {
    registered: true,
    setupStatus,
    needsSetup: !ready,
    biometricBound: Number(device.biometric_bound ?? 0) === 1,
  };
}

export async function createDeviceChallenge(deviceId: string, emailRaw: string): Promise<{ challengeId: string; nonce: string }> {
  const email = emailRaw.trim().toLowerCase();
  const device = await one("SELECT * FROM devices WHERE id = ?", deviceId);
  if (!device || text(device, "status") !== "ACTIVE") {
    throw new HttpError(403, "DEVICE_REVOKED", "This phone is not registered. Ask HR to reset it, then activate again.");
  }
  const employee = await one("SELECT * FROM employees WHERE id = ?", text(device, "employee_id"));
  const user = await one("SELECT * FROM users WHERE id = ?", text(employee!, "user_id"));
  if (!user || text(user, "email") !== email || text(user, "status") !== "ACTIVE") {
    throw new HttpError(403, "EMAIL_MISMATCH", "Enter the work email registered on this phone.");
  }
  const nonce = randomBytes(32).toString("base64url");
  const challengeId = randomUUID();
  await run(
    `INSERT INTO device_challenges (id, device_id, nonce, expires_at, verified_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    challengeId,
    deviceId,
    nonce,
    plusMinutes(CHALLENGE_MINUTES),
    nowIso(),
  );
  return { challengeId, nonce };
}

export async function verifyDeviceChallenge(challengeId: string, signatureB64: string): { deviceProof: string } {
  const challenge = await one("SELECT * FROM device_challenges WHERE id = ?", challengeId);
  if (!challenge || challenge.verified_at || text(challenge, "expires_at") < nowIso()) {
    throw new HttpError(400, "CHALLENGE_EXPIRED", "Fingerprint verification expired. Try again.");
  }
  const device = await one("SELECT * FROM devices WHERE id = ? AND status = 'ACTIVE'", text(challenge, "device_id"));
  if (!device) throw new HttpError(403, "DEVICE_REVOKED", "This phone is not registered. Ask HR to reset it, then activate again.");
  const key = createPublicKey({ key: Buffer.from(text(device, "public_key_spki"), "base64"), format: "der", type: "spki" });
  const nonce = Buffer.from(text(challenge, "nonce"), "base64url");
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureB64, "base64");
  } catch {
    throw new HttpError(400, "BAD_SIGNATURE", "The phone could not prove it holds the registered key.");
  }
  let valid = false;
  try {
    valid = verify("sha256", nonce, key, signature);
  } catch {
    valid = false;
  }
  if (!valid) throw new HttpError(400, "BAD_SIGNATURE", "The phone could not prove it holds the registered key.");
  await run("UPDATE device_challenges SET verified_at = ? WHERE id = ?", nowIso(), challengeId);
  const employee = await one("SELECT * FROM employees WHERE id = ?", text(device, "employee_id"))!;
  const proof = randomToken();
  await run(
    `INSERT INTO tokens (id, user_id, kind, token_hash, device_id, expires_at, used_at, created_at)
     VALUES (?, ?, 'DEVICE_PROOF', ?, ?, ?, NULL, ?)`,
    randomUUID(),
    text(employee, "user_id"),
    sha256(proof),
    text(device, "id"),
    plusMinutes(DEVICE_PROOF_MINUTES),
    nowIso(),
  );
  return { deviceProof: proof };
}

function employeeSummary(row: SqlRow) {
  const isManager = Number(row.is_manager ?? 0) === 1;
  return {
    id: text(row, "id"),
    employeeCode: text(row, "employee_code"),
    fullName: text(row, "full_name"),
    department: text(row, "department"),
    designation: text(row, "designation"),
    phone: optionalText(row, "phone"),
    isManager,
    accessRole: isManager ? ("MANAGER" as const) : ("EMPLOYEE" as const),
    managerId: optionalText(row, "manager_id"),
    managerName: optionalText(row, "manager_name"),
  };
}

async function assertValidManagerId(managerId: string | null | undefined, employeeId?: string | null) {
  if (!managerId) return null;
  if (employeeId && managerId === employeeId) {
    throw new HttpError(400, "INVALID_MANAGER", "An employee cannot report to themselves.");
  }
  const manager = await one("SELECT id, is_manager FROM employees WHERE id = ?", managerId);
  if (!manager) throw new HttpError(404, "MANAGER_NOT_FOUND", "Reporting manager not found.");
  if (Number(manager.is_manager ?? 0) !== 1) {
    throw new HttpError(400, "INVALID_MANAGER", "Reporting manager must have the Manager role.");
  }
  return managerId;
}

function initialsFromName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

async function requireManager(session: SessionContext): Promise<{ employeeId: string; deviceId: string }> {
  const actor = await requireEmployee(session);
  const row = await one("SELECT is_manager FROM employees WHERE id = ?", actor.employeeId);
  if (!row || Number(row.is_manager ?? 0) !== 1) {
    throw new HttpError(403, "FORBIDDEN", "Manager access is required.");
  }
  return actor;
}

function requireAdmin(session: SessionContext): void {
  if (session.user.role !== "ADMIN") throw new HttpError(403, "FORBIDDEN", "HR access is required.");
}

async function requireEmployee(session: SessionContext): { employeeId: string; deviceId: string } {
  if (session.user.role !== "EMPLOYEE" || !session.employeeId || !session.deviceId) {
    throw new HttpError(403, "FORBIDDEN", "Use the employee app for attendance.");
  }
  const device = await one("SELECT status FROM devices WHERE id = ?", session.deviceId);
  if (!device || text(device, "status") !== "ACTIVE") {
    throw new HttpError(403, "DEVICE_REVOKED", "This phone was reset by HR. Activate it again.");
  }
  return { employeeId: session.employeeId, deviceId: session.deviceId };
}

export async function createEmployee(session: SessionContext, input: {
  fullName: string;
  email: string;
  employeeCode: string;
  department: string;
  designation: string;
  phone?: string | null;
  isManager?: boolean;
  managerId?: string | null;
}) {
  requireAdmin(session);
  return await upsertEmployee(session.user.id, input, { allowUpdate: false });
}

export async function updateEmployeeAccess(
  session: SessionContext,
  input: { employeeId: string; isManager: boolean; managerId?: string | null },
) {
  requireAdmin(session);
  const employee = await one("SELECT id FROM employees WHERE id = ?", input.employeeId);
  if (!employee) throw new HttpError(404, "NOT_FOUND", "Employee not found.");
  const managerId = await assertValidManagerId(input.managerId ?? null, input.employeeId);
  if (!input.isManager) {
    const reports = await one("SELECT id FROM employees WHERE manager_id = ? LIMIT 1", input.employeeId);
    if (reports) {
      throw new HttpError(
        409,
        "HAS_REPORTS",
        "Reassign this manager's team before removing Manager access.",
      );
    }
  }
  await run(
    "UPDATE employees SET is_manager = ?, manager_id = ? WHERE id = ?",
    input.isManager ? 1 : 0,
    managerId,
    input.employeeId,
  );
  await audit(
    session.user.id,
    "EMPLOYEE_ACCESS_UPDATED",
    "employee",
    input.employeeId,
    `isManager=${input.isManager}; managerId=${managerId ?? "none"}`,
  );
  return await getEmployee(input.employeeId);
}

export async function deleteEmployee(session: SessionContext, employeeId: string) {
  requireAdmin(session);
  const row = await one(
    `SELECT e.id, e.user_id, e.full_name, e.employee_code, e.is_manager, u.email
     FROM employees e JOIN users u ON u.id = e.user_id
     WHERE e.id = ?`,
    employeeId,
  );
  if (!row) throw new HttpError(404, "NOT_FOUND", "Employee not found.");
  if (Number(row.is_manager ?? 0) === 1) {
    const reports = await one("SELECT id FROM employees WHERE manager_id = ? LIMIT 1", employeeId);
    if (reports) {
      throw new HttpError(
        409,
        "HAS_REPORTS",
        "Reassign this manager's team before deleting them.",
      );
    }
  }
  await transaction(async () => {
    await run("UPDATE devices SET status = 'REVOKED' WHERE employee_id = ?", employeeId);
    await run("UPDATE employees SET manager_id = NULL WHERE manager_id = ?", employeeId);
    await run("UPDATE users SET status = 'INACTIVE' WHERE id = ?", text(row, "user_id"));
    await audit(
      session.user.id,
      "EMPLOYEE_DELETED",
      "employee",
      employeeId,
      `${text(row, "full_name")} (${text(row, "employee_code")})`,
    );
  });
  return { deleted: true, employeeId, email: text(row, "email") };
}

async function upsertEmployee(
  actorUserId: string,
  input: {
    fullName: string;
    email: string;
    employeeCode: string;
    department: string;
    designation: string;
    phone?: string | null;
    isManager?: boolean;
    managerId?: string | null;
  },
  options: { allowUpdate: boolean },
) {
  const email = input.email.trim().toLowerCase();
  const employeeCode = input.employeeCode.trim().toUpperCase();
  const fullName = input.fullName.trim();
  const department = await ensureCatalogName("departments", input.department);
  const designation = await ensureCatalogName("designations", input.designation);
  const phone = input.phone?.trim() ? input.phone.trim() : null;
  const setAccess = input.isManager !== undefined || input.managerId !== undefined;
  const isManagerFlag = input.isManager === true ? 1 : 0;

  const byCode = await one(
    `SELECT e.id, e.user_id, u.email
     FROM employees e JOIN users u ON u.id = e.user_id
     WHERE e.employee_code = ?`,
    employeeCode,
  );
  const byEmail = await one("SELECT id, email FROM users WHERE email = ?", email);

  if (byCode) {
    if (!options.allowUpdate) {
      throw new HttpError(409, "CODE_IN_USE", "This employee code is already used.");
    }
    if (byEmail && text(byEmail, "id") !== text(byCode, "user_id")) {
      throw new HttpError(409, "EMAIL_IN_USE", "An account with this email already exists.");
    }
    const employeeId = text(byCode, "id");
    const managerId = setAccess
      ? await assertValidManagerId(input.managerId ?? null, employeeId)
      : null;
    await transaction(async () => {
      await run("UPDATE users SET email = ? WHERE id = ?", email, text(byCode, "user_id"));
      if (setAccess) {
        await run(
          `UPDATE employees
           SET full_name = ?, department = ?, designation = ?, phone = ?, is_manager = ?, manager_id = ?
           WHERE id = ?`,
          fullName,
          department,
          designation,
          phone,
          input.isManager === undefined
            ? Number((await one("SELECT is_manager FROM employees WHERE id = ?", employeeId))?.is_manager ?? 0)
            : isManagerFlag,
          managerId,
          employeeId,
        );
      } else {
        await run(
          `UPDATE employees
           SET full_name = ?, department = ?, designation = ?, phone = ?
           WHERE id = ?`,
          fullName,
          department,
          designation,
          phone,
          employeeId,
        );
      }
      await audit(actorUserId, "EMPLOYEE_UPDATED", "employee", employeeId, `${fullName} (${employeeCode})`);
    });
    return { ...(await getEmployee(employeeId)), imported: "updated" as const };
  }

  if (byEmail) {
    throw new HttpError(409, "EMAIL_IN_USE", "An account with this email already exists.");
  }

  const managerId = await assertValidManagerId(input.managerId ?? null, null);
  const userId = randomUUID();
  const employeeId = randomUUID();
  const createdAt = nowIso();
  await transaction(async () => {
    await run(
      "INSERT INTO users (id, email, role, status, created_at) VALUES (?, ?, 'EMPLOYEE', 'ACTIVE', ?)",
      userId,
      email,
      createdAt,
    );
    await run(
      `INSERT INTO employees (id, user_id, employee_code, full_name, department, designation, phone, is_manager, manager_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      employeeId,
      userId,
      employeeCode,
      fullName,
      department,
      designation,
      phone,
      isManagerFlag,
      managerId,
      createdAt,
    );
    await audit(actorUserId, "EMPLOYEE_CREATED", "employee", employeeId, `${fullName} (${employeeCode})`);
  });
  return { ...(await getEmployee(employeeId)), imported: "created" as const };
}

export async function importEmployees(
  session: SessionContext,
  rows: Array<{
    fullName: string;
    email: string;
    employeeCode: string;
    department: string;
    designation: string;
    phone?: string | null;
  }>,
) {
  requireAdmin(session);
  const created: string[] = [];
  const updated: string[] = [];
  const rejected: Array<{ employeeCode: string; email: string; reason: string }> = [];

  for (const row of rows) {
    try {
      const result = await upsertEmployee(session.user.id, row, { allowUpdate: true });
      if (result.imported === "created") created.push(result.employeeCode);
      else updated.push(result.employeeCode);
    } catch (error) {
      rejected.push({
        employeeCode: row.employeeCode,
        email: row.email,
        reason: error instanceof HttpError ? error.message : "Could not import this row.",
      });
    }
  }

  await audit(
    session.user.id,
    "EMPLOYEE_IMPORT",
    "employees",
    null,
    `created=${created.length}; updated=${updated.length}; rejected=${rejected.length}`,
  );

  return {
    createdCount: created.length,
    updatedCount: updated.length,
    rejectedCount: rejected.length,
    created,
    updated,
    rejected,
  };
}

async function getEmployee(employeeId: string) {
  const row = await one(
    `SELECT e.*, u.email, u.status, m.full_name AS manager_name
     FROM employees e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN employees m ON m.id = e.manager_id
     WHERE e.id = ?`,
    employeeId,
  );
  if (!row) throw new HttpError(404, "NOT_FOUND", "Employee not found.");
  const devices = (await many(
    "SELECT id, label, biometric_bound, status, created_at FROM devices WHERE employee_id = ? ORDER BY created_at DESC",
    employeeId,
  )).map((device) => ({
    id: text(device, "id"),
    label: text(device, "label"),
    biometricBound: num(device, "biometric_bound") === 1,
    status: text(device, "status"),
    createdAt: text(device, "created_at"),
  }));
  return {
    ...employeeSummary(row),
    email: text(row, "email"),
    status: text(row, "status"),
    devices,
  };
}

export async function listEmployees(session: SessionContext) {
  requireAdmin(session);
  const rows = await many(
    `SELECT e.id FROM employees e JOIN users u ON u.id = e.user_id
     WHERE u.status = 'ACTIVE'
     ORDER BY e.full_name`,
  );
  return Promise.all(rows.map((row) => getEmployee(text(row, "id"))));
}

export async function hrContext(session: SessionContext) {
  requireAdmin(session);
  await syncOrgCatalogFromEmployees();
  const workplaces = (await many("SELECT * FROM workplaces ORDER BY name")).map(workplaceView);
  const shifts = (await many("SELECT * FROM shift_templates ORDER BY start_time, name")).map((row) => ({
    id: text(row, "id"),
    name: text(row, "name"),
    startTime: text(row, "start_time"),
    endTime: text(row, "end_time"),
    graceMinutes: num(row, "grace_minutes"),
    crossesMidnight: text(row, "end_time") <= text(row, "start_time"),
  }));
  const timezone = workplaces[0]?.timezone ?? "Asia/Kolkata";
  const today = todayInZone(timezone);
  return {
    today,
    todayLabel: formatDateLabel(today),
    timezone,
    workplaces,
    shifts,
    departments: await listCatalog("departments"),
    designations: await listCatalog("designations"),
  };
}

function workplaceView(row: SqlRow) {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    timezone: text(row, "timezone"),
    latitude: num(row, "latitude"),
    longitude: num(row, "longitude"),
    radiusMeters: num(row, "radius_meters"),
  };
}

export async function assignShift(session: SessionContext, input: {
  employeeId: string;
  workplaceId: string;
  shiftTemplateId: string;
  workDate: string;
}) {
  requireAdmin(session);
  const employee = await one("SELECT e.id, u.status FROM employees e JOIN users u ON u.id = e.user_id WHERE e.id = ?", input.employeeId);
  if (!employee || text(employee, "status") !== "ACTIVE") {
    throw new HttpError(404, "NOT_FOUND", "Choose an active employee.");
  }
  const workplace = await one("SELECT id FROM workplaces WHERE id = ?", input.workplaceId);
  const shift = await one("SELECT id FROM shift_templates WHERE id = ?", input.shiftTemplateId);
  if (!workplace || !shift) throw new HttpError(400, "INVALID_ASSIGNMENT", "Choose a workplace and a shift.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) {
    throw new HttpError(400, "INVALID_DATE", "Choose a valid date.");
  }
  const existing = await one(
    `SELECT a.id AS id, s.id AS session_id
     FROM shift_assignments a
     LEFT JOIN attendance_sessions s ON s.assignment_id = a.id
     WHERE a.employee_id = ? AND a.work_date = ?`,
    input.employeeId,
    input.workDate,
  );
  if (existing && optionalText(existing, "session_id")) {
    throw new HttpError(409, "ATTENDANCE_STARTED", "Attendance has already started for this date. The shift cannot be replaced.");
  }
  const id = existing ? text(existing, "id") : randomUUID();
  if (existing) {
    await run(
      "UPDATE shift_assignments SET workplace_id = ?, shift_template_id = ? WHERE id = ?",
      input.workplaceId,
      input.shiftTemplateId,
      id,
    );
  } else {
    await run(
      `INSERT INTO shift_assignments (id, employee_id, workplace_id, shift_template_id, work_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      input.employeeId,
      input.workplaceId,
      input.shiftTemplateId,
      input.workDate,
      nowIso(),
    );
  }
  await audit(session.user.id, "SHIFT_ASSIGNED", "shift_assignment", id, `${input.workDate} ${input.shiftTemplateId}`);
  return { assignmentId: id, workDate: input.workDate, workDateLabel: formatDateLabel(input.workDate) };
}

type AssignmentBundle = {
  assignmentId: string;
  employeeId: string;
  workDate: string;
  workplace: ReturnType<typeof workplaceView>;
  shift: {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    graceMinutes: number;
    crossesMidnight: boolean;
  };
};

async function loadAssignment(assignmentId: string): AssignmentBundle {
  const row = await one(
    `SELECT a.id assignment_id, a.employee_id, a.work_date,
            w.id workplace_id, w.name workplace_name, w.timezone, w.latitude, w.longitude, w.radius_meters,
            t.id shift_id, t.name shift_name, t.start_time, t.end_time, t.grace_minutes
     FROM shift_assignments a
     JOIN workplaces w ON w.id = a.workplace_id
     JOIN shift_templates t ON t.id = a.shift_template_id
     WHERE a.id = ?`,
    assignmentId,
  );
  if (!row) throw new HttpError(404, "NOT_FOUND", "Shift assignment not found.");
  return bundleFromRow(row);
}

function bundleFromRow(row: SqlRow): AssignmentBundle {
  return {
    assignmentId: text(row, "assignment_id"),
    employeeId: text(row, "employee_id"),
    workDate: text(row, "work_date"),
    workplace: {
      id: text(row, "workplace_id"),
      name: text(row, "workplace_name"),
      timezone: text(row, "timezone"),
      latitude: num(row, "latitude"),
      longitude: num(row, "longitude"),
      radiusMeters: num(row, "radius_meters"),
    },
    shift: {
      id: text(row, "shift_id"),
      name: text(row, "shift_name"),
      startTime: text(row, "start_time"),
      endTime: text(row, "end_time"),
      graceMinutes: num(row, "grace_minutes"),
      crossesMidnight: text(row, "end_time") <= text(row, "start_time"),
    },
  };
}

/** Auto-creates today's General / Head Office assignment when HR is not assigning shifts. */
async function ensureTodayAssignment(employeeId: string): Promise<AssignmentBundle | undefined> {
  const existing = await assignmentForToday(employeeId, new Date());
  if (existing) return existing;
  const workplace = await one("SELECT id, timezone FROM workplaces ORDER BY name LIMIT 1");
  const shift = await one(
    `SELECT id FROM shift_templates
     WHERE id = 'shift-general' OR name = 'General shift'
     ORDER BY CASE WHEN id = 'shift-general' THEN 0 ELSE 1 END
     LIMIT 1`,
  );
  if (!workplace || !shift) return undefined;
  const workDate = todayInZone(text(workplace, "timezone"));
  const id = randomUUID();
  await run(
    `INSERT INTO shift_assignments (id, employee_id, workplace_id, shift_template_id, work_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    employeeId,
    text(workplace, "id"),
    text(shift, "id"),
    workDate,
    nowIso(),
  );
  return await assignmentForToday(employeeId, new Date());
}

async function assignmentForToday(employeeId: string, at: Date): AssignmentBundle | undefined {
  const rows = await many(
    `SELECT a.id assignment_id, a.employee_id, a.work_date,
            w.id workplace_id, w.name workplace_name, w.timezone, w.latitude, w.longitude, w.radius_meters,
            t.id shift_id, t.name shift_name, t.start_time, t.end_time, t.grace_minutes
     FROM shift_assignments a
     JOIN workplaces w ON w.id = a.workplace_id
     JOIN shift_templates t ON t.id = a.shift_template_id
     WHERE a.employee_id = ?
     ORDER BY a.work_date DESC`,
    employeeId,
  );
  const matches: AssignmentBundle[] = [];
  for (const row of rows) {
    const bundle = bundleFromRow(row);
    const today = todayInZone(bundle.workplace.timezone, at);
    const bounds = shiftBounds(bundle.workDate, bundle.shift.startTime, bundle.shift.endTime, bundle.workplace.timezone);
    const sameDay = bundle.workDate === today;
    const overnightStillRunning =
      bundle.shift.crossesMidnight && bundle.workDate === addDays(today, -1) && at.getTime() <= bounds.endUtc.getTime();
    if (sameDay || overnightStillRunning) matches.push(bundle);
  }
  for (const bundle of matches) {
    if ((await sessionStatus(bundle.assignmentId)) !== "CLOSED") return bundle;
  }
  return matches[0];
}

async function sessionStatus(assignmentId: string): "OPEN" | "CLOSED" | null {
  const session = await one("SELECT status FROM attendance_sessions WHERE assignment_id = ?", assignmentId);
  if (!session) return null;
  return text(session, "status") as "OPEN" | "CLOSED";
}

function evaluateRemoteLocation(input: {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  addressLine?: string | null;
  mapsUrl?: string | null;
  streetViewUrl?: string | null;
}): { addressLine: string; mapsUrl: string; streetViewUrl: string } {
  if (!Number.isFinite(input.accuracyMeters) || input.accuracyMeters > POOR_GPS_METERS) {
    throw new HttpError(
      422,
      "POOR_GPS",
      "The location is not accurate enough. Move near a window or try again. This does not mark you absent.",
    );
  }
  const addressLine = input.addressLine?.trim() ?? "";
  if (addressLine.length < 8) {
    throw new HttpError(
      422,
      "ADDRESS_REQUIRED",
      "A full street address is required for check-in and check-out (including work-from-home).",
    );
  }
  // Always derive map links from coordinates — never trust client-supplied URLs.
  const mapsUrl = `https://www.google.com/maps?q=${input.latitude},${input.longitude}`;
  const streetViewUrl =
    `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${input.latitude},${input.longitude}`;
  return { addressLine, mapsUrl, streetViewUrl };
}

async function latestEventLocation(sessionId: string, eventType: "CHECK_IN" | "CHECK_OUT") {
  const row = await one(
    `SELECT latitude, longitude, accuracy_meters, address_line, maps_url, street_view_url
     FROM attendance_events
     WHERE session_id = ? AND event_type = ?
     ORDER BY server_time DESC
     LIMIT 1`,
    sessionId,
    eventType,
  );
  if (!row) return null;
  return {
    latitude: num(row, "latitude"),
    longitude: num(row, "longitude"),
    accuracyMeters: num(row, "accuracy_meters"),
    addressLine: optionalText(row, "address_line"),
    mapsUrl: optionalText(row, "maps_url"),
    streetViewUrl: optionalText(row, "street_view_url"),
  };
}

async function attendanceView(sessionId: string, at = new Date()) {
  const row = await one(
    `SELECT s.*, a.work_date, w.timezone, w.name workplace_name,
            t.name shift_name, t.start_time, t.end_time, t.grace_minutes
     FROM attendance_sessions s
     JOIN shift_assignments a ON a.id = s.assignment_id
     JOIN workplaces w ON w.id = s.workplace_id
     JOIN shift_templates t ON t.id = a.shift_template_id
     WHERE s.id = ?`,
    sessionId,
  );
  if (!row) throw new HttpError(404, "NOT_FOUND", "Attendance record not found.");
  const timezone = text(row, "timezone");
  const checkInAt = text(row, "check_in_at");
  const checkOutAt = optionalText(row, "check_out_at");
  const closed = text(row, "status") === "CLOSED" && checkOutAt;
  const netMinutes = closed ? num(row, "net_minutes") : netMinutesBetween(checkInAt, at.toISOString());
  const checkInLocation = await latestEventLocation(text(row, "id"), "CHECK_IN");
  const checkOutLocation = checkOutAt ? await latestEventLocation(text(row, "id"), "CHECK_OUT") : null;
  return {
    sessionId: text(row, "id"),
    status: text(row, "status"),
    workDate: text(row, "work_date"),
    workDateLabel: formatDateLabel(text(row, "work_date")),
    workplaceName: text(row, "workplace_name"),
    shiftName: text(row, "shift_name"),
    shiftStart: text(row, "start_time"),
    shiftEnd: text(row, "end_time"),
    checkInAt,
    checkOutAt,
    checkInLabel: formatTimeInZone(checkInAt, timezone),
    checkOutLabel: checkOutAt ? formatTimeInZone(checkOutAt, timezone) : null,
    arrival: text(row, "arrival"),
    departure: optionalText(row, "departure"),
    netMinutes,
    hoursLabel: formatDuration(netMinutes),
    checkInLocation,
    checkOutLocation,
    serverNow: at.toISOString(),
  };
}

export async function checkIn(session: SessionContext, input: {
  requestId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  addressLine?: string | null;
  mapsUrl?: string | null;
  streetViewUrl?: string | null;
}) {
  const actor = await requireEmployee(session);
  return transaction(async () => {
    const existing = await one("SELECT * FROM attendance_events WHERE request_id = ?", input.requestId);
    if (existing) {
      if (text(existing, "employee_id") !== actor.employeeId) {
        throw new HttpError(409, "REQUEST_CONFLICT", "This request belongs to another employee.");
      }
      return await attendanceView(text(existing, "session_id"));
    }
    const open = await one("SELECT id FROM attendance_sessions WHERE employee_id = ? AND status = 'OPEN'", actor.employeeId);
    if (open) return await attendanceView(text(open, "id"));

    const assignment = await ensureTodayAssignment(actor.employeeId);
    if (!assignment) {
      throw new HttpError(409, "NO_SHIFT", "No workplace or default shift is configured.");
    }
    if (await sessionStatus(assignment.assignmentId) === "CLOSED") {
      throw new HttpError(409, "ALREADY_COMPLETE", "Today's shift is already checked out.");
    }
    const place = evaluateRemoteLocation(input);
    const serverTime = nowIso();
    const arrival = arrivalStatus(
      serverTime,
      assignment.workDate,
      assignment.shift.startTime,
      assignment.shift.graceMinutes,
      assignment.workplace.timezone,
    );
    const sessionId = randomUUID();
    await run(
      `INSERT INTO attendance_sessions (
         id, employee_id, assignment_id, workplace_id, check_in_at, check_out_at,
         check_in_request_id, check_out_request_id, status, arrival, departure, net_minutes, created_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 'OPEN', ?, NULL, NULL, ?)`,
      sessionId,
      actor.employeeId,
      assignment.assignmentId,
      assignment.workplace.id,
      serverTime,
      input.requestId,
      arrival,
      serverTime,
    );
    await run(
      `INSERT INTO attendance_events (
         id, session_id, employee_id, event_type, server_time, latitude, longitude, accuracy_meters,
         address_line, maps_url, street_view_url, request_id
       ) VALUES (?, ?, ?, 'CHECK_IN', ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      sessionId,
      actor.employeeId,
      serverTime,
      input.latitude,
      input.longitude,
      input.accuracyMeters,
      place.addressLine,
      place.mapsUrl,
      place.streetViewUrl,
      input.requestId,
    );
    await audit(session.user.id, "CHECK_IN", "attendance_session", sessionId, `${arrival}; ${place.addressLine}`);
    await scheduleFourHourWorkListReminder({
      employeeId: actor.employeeId,
      assignmentId: assignment.assignmentId,
      sessionId,
      workDate: assignment.workDate,
      checkInAt: serverTime,
    });
    return await attendanceView(sessionId);
  });
}

export async function checkOut(session: SessionContext, input: {
  requestId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  addressLine?: string | null;
  mapsUrl?: string | null;
  streetViewUrl?: string | null;
}) {
  const actor = await requireEmployee(session);
  return transaction(async () => {
    const existing = await one("SELECT * FROM attendance_events WHERE request_id = ?", input.requestId);
    if (existing) {
      if (text(existing, "employee_id") !== actor.employeeId || text(existing, "event_type") !== "CHECK_OUT") {
        throw new HttpError(409, "REQUEST_CONFLICT", "This request does not match an existing check-out.");
      }
      return await attendanceView(text(existing, "session_id"));
    }
    const open = await one("SELECT * FROM attendance_sessions WHERE employee_id = ? AND status = 'OPEN'", actor.employeeId);
    if (!open) throw new HttpError(409, "NO_OPEN_SESSION", "Check in before checking out. A missing punch can be corrected later by HR.");
    const assignment = await loadAssignment(text(open, "assignment_id"));
    const place = evaluateRemoteLocation(input);
    const serverTime = nowIso();
    const netMinutes = netMinutesBetween(text(open, "check_in_at"), serverTime);
    const departure = departureStatus(
      serverTime,
      assignment.workDate,
      assignment.shift.startTime,
      assignment.shift.endTime,
      assignment.workplace.timezone,
    );
    await run(
      `UPDATE attendance_sessions
       SET check_out_at = ?, check_out_request_id = ?, status = 'CLOSED', departure = ?, net_minutes = ?
       WHERE id = ?`,
      serverTime,
      input.requestId,
      departure,
      netMinutes,
      text(open, "id"),
    );
    await run(
      `INSERT INTO attendance_events (
         id, session_id, employee_id, event_type, server_time, latitude, longitude, accuracy_meters,
         address_line, maps_url, street_view_url, request_id
       ) VALUES (?, ?, ?, 'CHECK_OUT', ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      text(open, "id"),
      actor.employeeId,
      serverTime,
      input.latitude,
      input.longitude,
      input.accuracyMeters,
      place.addressLine,
      place.mapsUrl,
      place.streetViewUrl,
      input.requestId,
    );
    await audit(session.user.id, "CHECK_OUT", "attendance_session", text(open, "id"), `${netMinutes} minutes; ${place.addressLine}`);
    await skipOpenWorkListReminders({
      employeeId: actor.employeeId,
      workDate: assignment.workDate,
      reason: "CLOCKED_OUT",
    });
    return await attendanceView(text(open, "id"));
  });
}

export async function registerPushToken(session: SessionContext, tokenRaw: string): Promise<{ ok: true }> {
  const actor = await requireEmployee(session);
  const token = tokenRaw.trim();
  if (token.length < 20) throw new HttpError(400, "INVALID_TOKEN", "Push token is not valid.");
  await saveDeviceFcmToken(actor.deviceId, token);
  return { ok: true };
}

export async function getWorkListStatus(session: SessionContext): Promise<Record<string, unknown>> {
  const actor = await requireEmployee(session);
  const open = await one(
    "SELECT * FROM attendance_sessions WHERE employee_id = ? AND status = 'OPEN'",
    actor.employeeId,
  );
  if (!open) {
    return {
      status: "UNAVAILABLE",
      reminderDue: false,
      message: null,
      pmWebUrl: pmWebAppUrl(),
      reason: "NO_OPEN_SESSION",
    };
  }
  const assignment = await loadAssignment(text(open, "assignment_id"));
  const employee = await getEmployee(actor.employeeId);
  const evaluated = await evaluateWorkListForEmployee({
    workDate: assignment.workDate,
    employeeEmail: employee.email,
    employeeCode: employee.employeeCode,
  });
  if (evaluated.status === "UNAVAILABLE") {
    await audit(
      session.user.id,
      "WORK_LIST_UNAVAILABLE",
      "attendance_session",
      text(open, "id"),
      evaluated.reason,
    );
  }
  return {
    status: evaluated.status,
    reminderDue: evaluated.status === "PENDING",
    message: evaluated.status === "PENDING" ? WORK_LIST_MESSAGE : null,
    pmWebUrl: evaluated.pmWebUrl,
    workDate: assignment.workDate,
    reason: evaluated.reason,
  };
}

export async function myProfile(session: SessionContext) {
  const employee = session.employeeId ? await getEmployee(session.employeeId) : null;
  const timezone = "Asia/Kolkata";
  const firstName = employee?.fullName.split(" ")[0] ?? "there";
  let workplaceName: string | null = null;
  if (session.employeeId) {
    const workplace = await one(
      `SELECT w.name
       FROM shift_assignments a
       JOIN workplaces w ON w.id = a.workplace_id
       WHERE a.employee_id = ?
       ORDER BY a.work_date DESC
       LIMIT 1`,
      session.employeeId,
    );
    workplaceName = workplace ? text(workplace, "name") : "Head Office";
  }
  let reportingManager: string | null = employee?.managerName ?? null;
  if (!reportingManager && employee?.managerId) {
    const manager = await one("SELECT full_name, designation FROM employees WHERE id = ?", employee.managerId);
    reportingManager = manager
      ? `${text(manager, "full_name")}${optionalText(manager, "designation") ? ` · ${optionalText(manager, "designation")}` : ""}`
      : null;
  }
  return {
    email: session.user.email,
    role: session.user.role,
    greeting: greetingFor(timezone),
    firstName,
    fullName: employee?.fullName ?? firstName,
    initials: initialsFromName(employee?.fullName ?? firstName),
    employeeCode: employee?.employeeCode ?? null,
    department: employee?.department ?? null,
    designation: employee?.designation ?? null,
    workplaceName,
    reportingManager: reportingManager ?? "Unassigned",
    accessRole: employee?.accessRole ?? "EMPLOYEE",
    isManager: employee?.isManager === true,
    managerId: employee?.managerId ?? null,
    pmWebUrl: pmWebAppUrl(),
    employee,
  };
}

export async function myShift(session: SessionContext) {
  const actor = await requireEmployee(session);
  const open = await one("SELECT assignment_id FROM attendance_sessions WHERE employee_id = ? AND status = 'OPEN'", actor.employeeId);
  if (open) return assignmentPayload(await loadAssignment(text(open, "assignment_id")));
  const assignment = await assignmentForToday(actor.employeeId, new Date());
  if (!assignment) {
    const today = todayInZone("Asia/Kolkata");
    return { assignment: null, today, todayLabel: formatDateLabel(today) };
  }
  return assignmentPayload(assignment);
}

export async function myShiftRoster(session: SessionContext, input: { weekStart?: string | null }) {
  const actor = await requireEmployee(session);
  const today = todayInZone("Asia/Kolkata");
  let weekStart = input.weekStart?.trim() || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    // Monday of current week
    const [y, m, d] = today.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const weekday = date.getUTCDay(); // 0 Sun .. 6 Sat
    const offset = weekday === 0 ? -6 : 1 - weekday;
    date.setUTCDate(date.getUTCDate() + offset);
    weekStart = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  const weekEnd = addDays(weekStart, 6);
  const rows = await many(
    `SELECT a.work_date, t.name shift_name, t.start_time, t.end_time, w.name workplace_name
     FROM shift_assignments a
     JOIN shift_templates t ON t.id = a.shift_template_id
     JOIN workplaces w ON w.id = a.workplace_id
     WHERE a.employee_id = ? AND a.work_date BETWEEN ? AND ?
     ORDER BY a.work_date`,
    actor.employeeId,
    weekStart,
    weekEnd,
  );
  const byDate = new Map(rows.map((row) => [text(row, "work_date"), row]));
  const days = [];
  let workingDays = 0;
  let offDays = 0;
  for (let i = 0; i < 7; i += 1) {
    const workDate = addDays(weekStart, i);
    const row = byDate.get(workDate);
    const [y, m, d] = workDate.split("-").map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    const weekdayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][utc.getUTCDay()];
    const monthShort = utc.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const dayLabel = `${weekdayShort} ${String(d).padStart(2, "0")} ${monthShort}`;
    if (row) {
      workingDays += 1;
      days.push({
        workDate,
        dayLabel,
        isOff: false,
        isToday: workDate === today,
        shiftName: text(row, "shift_name"),
        shiftWindow: `${text(row, "start_time")} - ${text(row, "end_time")}`,
        workplaceName: text(row, "workplace_name"),
        offLabel: null as string | null,
      });
    } else {
      offDays += 1;
      days.push({
        workDate,
        dayLabel,
        isOff: true,
        isToday: workDate === today,
        shiftName: null as string | null,
        shiftWindow: null as string | null,
        workplaceName: null as string | null,
        offLabel: "Weekly off",
      });
    }
  }
  return {
    weekStart,
    weekEnd,
    weekLabel: `${formatDateLabel(weekStart)} — ${formatDateLabel(weekEnd)}`,
    summaryLabel: `${workingDays} working day${workingDays === 1 ? "" : "s"} • ${offDays} day${offDays === 1 ? "" : "s"} off`,
    workingDays,
    offDays,
    days,
  };
}

function assignmentPayload(assignment: AssignmentBundle) {
  return {
    assignment: {
      id: assignment.assignmentId,
      workDate: assignment.workDate,
      workDateLabel: formatDateLabel(assignment.workDate),
      shiftName: assignment.shift.name,
      shiftStart: assignment.shift.startTime,
      shiftEnd: assignment.shift.endTime,
      crossesMidnight: assignment.shift.crossesMidnight,
      workplace: assignment.workplace,
    },
  };
}

export async function myAttendanceToday(session: SessionContext) {
  const actor = await requireEmployee(session);
  const open = await one("SELECT id, assignment_id FROM attendance_sessions WHERE employee_id = ? AND status = 'OPEN'", actor.employeeId);
  if (open) {
    return {
      attendance: await attendanceView(text(open, "id")),
      shift: assignmentPayload(await loadAssignment(text(open, "assignment_id"))).assignment,
    };
  }
  const assignment = await assignmentForToday(actor.employeeId, new Date());
  if (!assignment) {
    return { attendance: null, shift: null, todayLabel: formatDateLabel(todayInZone("Asia/Kolkata")) };
  }
  const existing = await one("SELECT id FROM attendance_sessions WHERE assignment_id = ?", assignment.assignmentId);
  return {
    attendance: existing ? await attendanceView(text(existing, "id")) : null,
    shift: assignmentPayload(assignment).assignment,
  };
}

export async function myAttendanceHistory(session: SessionContext, input: { month: string }) {
  const actor = await requireEmployee(session);
  if (!/^\d{4}-\d{2}$/.test(input.month)) {
    throw new HttpError(400, "INVALID_MONTH", "Choose a valid month (YYYY-MM).");
  }
  const [year, month] = input.month.split("-").map(Number);
  const from = `${input.month}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${input.month}-${String(lastDay).padStart(2, "0")}`;

  const rows = await many(
    `SELECT a.work_date, w.name workplace_name, w.timezone, t.name shift_name, t.start_time, t.end_time,
            s.status, s.check_in_at, s.check_out_at, s.arrival, s.departure, s.net_minutes,
            l.leave_type, l.note leave_note
     FROM shift_assignments a
     JOIN workplaces w ON w.id = a.workplace_id
     JOIN shift_templates t ON t.id = a.shift_template_id
     LEFT JOIN attendance_sessions s ON s.assignment_id = a.id
     LEFT JOIN leave_entries l ON l.employee_id = a.employee_id AND l.work_date = a.work_date
     WHERE a.employee_id = ? AND a.work_date BETWEEN ? AND ?
     ORDER BY a.work_date`,
    actor.employeeId,
    from,
    to,
  );

  const leaveOnly = await many(
    `SELECT l.work_date, l.leave_type, l.note leave_note
     FROM leave_entries l
     WHERE l.employee_id = ? AND l.work_date BETWEEN ? AND ?
       AND NOT EXISTS (
         SELECT 1 FROM shift_assignments a
         WHERE a.employee_id = l.employee_id AND a.work_date = l.work_date
       )
     ORDER BY l.work_date`,
    actor.employeeId,
    from,
    to,
  );

  const serverNow = new Date();
  const days = [
    ...rows.map((row) => {
      const timezone = text(row, "timezone");
      const checkInAt = optionalText(row, "check_in_at");
      const checkOutAt = optionalText(row, "check_out_at");
      const status = optionalText(row, "status");
      const leaveType = optionalText(row, "leave_type");
      const present = status === "CLOSED" || status === "OPEN";
      const attendanceKind = present ? "PRESENT" : leaveType ? "LEAVE" : "ABSENT";
      const netMinutes = status === "CLOSED"
        ? optionalNum(row, "net_minutes")
        : checkInAt
          ? netMinutesBetween(checkInAt, serverNow.toISOString())
          : null;
      return {
        workDate: text(row, "work_date"),
        workDateLabel: formatDateLabel(text(row, "work_date")),
        attendanceKind,
        status: present ? status! : leaveType ? "LEAVE" : "NOT_CHECKED_IN",
        leaveType,
        leaveTypeLabel: leaveType ? leaveTypeLabel(leaveType) : null,
        workplaceName: text(row, "workplace_name"),
        shiftName: text(row, "shift_name"),
        shiftStart: text(row, "start_time"),
        shiftEnd: text(row, "end_time"),
        checkInLabel: checkInAt ? formatTimeInZone(checkInAt, timezone) : null,
        checkOutLabel: checkOutAt ? formatTimeInZone(checkOutAt, timezone) : null,
        hoursLabel: netMinutes === null ? null : formatDuration(netMinutes),
        netMinutes,
        breaksLabel: null as string | null,
        arrival: optionalText(row, "arrival"),
      };
    }),
    ...leaveOnly.map((row) => ({
      workDate: text(row, "work_date"),
      workDateLabel: formatDateLabel(text(row, "work_date")),
      attendanceKind: "LEAVE" as const,
      status: "LEAVE",
      leaveType: text(row, "leave_type"),
      leaveTypeLabel: leaveTypeLabel(text(row, "leave_type")),
      workplaceName: null as string | null,
      shiftName: "Leave",
      shiftStart: null as string | null,
      shiftEnd: null as string | null,
      checkInLabel: null as string | null,
      checkOutLabel: null as string | null,
      hoursLabel: null as string | null,
      netMinutes: null as number | null,
      breaksLabel: null as string | null,
      arrival: null as string | null,
    })),
  ].sort((a, b) => a.workDate.localeCompare(b.workDate));

  let present = 0;
  let absent = 0;
  let leave = 0;
  for (const day of days) {
    if (day.attendanceKind === "PRESENT") present += 1;
    else if (day.attendanceKind === "LEAVE") leave += 1;
    else absent += 1;
  }

  return {
    month: input.month,
    from,
    to,
    summary: { present, absent, leave },
    days,
  };
}

const LEAVE_TYPES = ["CASUAL", "SICK", "EARNED", "ANNUAL", "UNPAID", "WEEK_OFF", "OTHER"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
const REQUEST_DURATIONS = ["HALF_DAY", "FULL_DAY"] as const;
type RequestDuration = (typeof REQUEST_DURATIONS)[number];

function daysInclusive(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function leaveTypeLabel(type: string): string {
  switch (type) {
    case "CASUAL": return "Casual leave";
    case "SICK": return "Sick leave";
    case "EARNED": return "Earned leave";
    case "ANNUAL": return "Annual leave";
    case "UNPAID": return "Unpaid leave";
    case "WEEK_OFF": return "Week off";
    default: return "Other leave";
  }
}

function formatSubmittedLabel(createdAt: string): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "Submitted";
  const today = todayInZone("Asia/Kolkata");
  const createdDay = created.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  if (createdDay === today) return "Submitted today";
  return `Submitted ${formatDateLabel(createdDay)}`;
}

function mapLeaveRequest(row: import("./db.js").SqlRow) {
  const leaveType = optionalText(row, "leave_type");
  const requestType = text(row, "request_type");
  const startDate = text(row, "start_date");
  const endDate = text(row, "end_date");
  const totalDays = Number(row.total_days ?? 0);
  const status = text(row, "status");
  const createdAt = text(row, "created_at");
  const title = requestType === "ATTENDANCE_CORRECTION"
    ? "Attendance correction"
    : leaveTypeLabel(leaveType ?? "OTHER");
  const dateLabel = startDate === endDate
    ? formatDateLabel(startDate)
    : `${formatDateLabel(startDate)} – ${formatDateLabel(endDate)}`;
  const daysText = totalDays === 0.5
    ? "Half day"
    : `${totalDays % 1 === 0 ? String(totalDays) : totalDays} day${totalDays === 1 ? "" : "s"}`;
  return {
    id: text(row, "id"),
    requestType,
    leaveType,
    leaveTypeLabel: leaveType ? leaveTypeLabel(leaveType) : null,
    title,
    startDate,
    endDate,
    dateLabel,
    duration: text(row, "duration"),
    totalDays,
    daysText,
    reason: optionalText(row, "reason"),
    attachmentName: optionalText(row, "attachment_name"),
    status,
    statusLabel: status === "APPROVED" ? "Approved" : status === "REJECTED" ? "Rejected" : "Pending",
    summary: `${daysText} • ${formatSubmittedLabel(createdAt)}`,
    reviewNote: optionalText(row, "review_note"),
    createdAt,
    approver: "Reporting manager",
    balanceDays: 8,
  };
}

function mapTeamRequest(row: import("./db.js").SqlRow) {
  const base = mapLeaveRequest(row);
  const fullName = text(row, "full_name");
  return {
    ...base,
    employeeId: text(row, "employee_id"),
    employeeName: fullName,
    employeeInitials: initialsFromName(fullName),
    department: text(row, "department"),
    designation: text(row, "designation"),
    workplaceName: optionalText(row, "workplace_name") ?? "Head Office",
    roleLabel: `Employee • ${text(row, "department")}`,
  };
}

export async function teamRequests(session: SessionContext) {
  const actor = await requireManager(session);
  const rows = await many(
    `SELECT r.*, e.full_name, e.department, e.designation,
            (
              SELECT w.name FROM shift_assignments a
              JOIN workplaces w ON w.id = a.workplace_id
              WHERE a.employee_id = e.id
              ORDER BY a.work_date DESC
              LIMIT 1
            ) workplace_name
     FROM leave_requests r
     JOIN employees e ON e.id = r.employee_id
     WHERE e.manager_id = ?
       AND e.id <> ?
     ORDER BY
       CASE r.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
       r.created_at DESC`,
    actor.employeeId,
    actor.employeeId,
  );
  const requests = rows.map((row) => mapTeamRequest(row));
  return {
    pendingCount: requests.filter((row) => row.status === "PENDING").length,
    approvedCount: requests.filter((row) => row.status === "APPROVED").length,
    rejectedCount: requests.filter((row) => row.status === "REJECTED").length,
    requests,
  };
}

export async function reviewTeamRequest(
  session: SessionContext,
  input: { requestId: string; decision: "APPROVED" | "REJECTED"; reviewNote?: string | null },
) {
  const actor = await requireManager(session);
  const row = await one(
    `SELECT r.*, e.full_name, e.department, e.designation, e.manager_id
     FROM leave_requests r
     JOIN employees e ON e.id = r.employee_id
     WHERE r.id = ?`,
    input.requestId,
  );
  if (!row) throw new HttpError(404, "NOT_FOUND", "Request not found.");
  if (optionalText(row, "manager_id") !== actor.employeeId) {
    throw new HttpError(403, "FORBIDDEN", "This request is outside your team.");
  }
  if (text(row, "status") !== "PENDING") {
    throw new HttpError(409, "ALREADY_REVIEWED", "This request was already reviewed.");
  }
  if (text(row, "employee_id") === actor.employeeId) {
    throw new HttpError(409, "SELF_REVIEW", "You cannot review your own request.");
  }
  const note = input.reviewNote?.trim() ? input.reviewNote.trim().slice(0, 500) : null;
  const reviewedAt = nowIso();
  await run(
    `UPDATE leave_requests
     SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?
     WHERE id = ?`,
    input.decision,
    note,
    actor.employeeId,
    reviewedAt,
    input.requestId,
  );

  if (input.decision === "APPROVED" && text(row, "request_type") === "LEAVE") {
    const leaveType = (optionalText(row, "leave_type") ?? "OTHER") as LeaveType;
    let cursor = text(row, "start_date");
    const end = text(row, "end_date");
    while (cursor <= end) {
      const existing = await one(
        "SELECT id FROM leave_entries WHERE employee_id = ? AND work_date = ?",
        text(row, "employee_id"),
        cursor,
      );
      if (existing) {
        await run(
          "UPDATE leave_entries SET leave_type = ?, note = ? WHERE id = ?",
          leaveType,
          note ?? optionalText(row, "reason"),
          text(existing, "id"),
        );
      } else {
        await run(
          `INSERT INTO leave_entries (id, employee_id, work_date, leave_type, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          randomUUID(),
          text(row, "employee_id"),
          cursor,
          leaveType,
          note ?? optionalText(row, "reason"),
          reviewedAt,
        );
      }
      cursor = addDays(cursor, 1);
    }
  }

  await audit(
    session.user.id,
    input.decision === "APPROVED" ? "LEAVE_REQUEST_APPROVED" : "LEAVE_REQUEST_REJECTED",
    "leave_request",
    input.requestId,
    note ?? input.decision,
  );

  const refreshed = await one(
    `SELECT r.*, e.full_name, e.department, e.designation,
            (
              SELECT w.name FROM shift_assignments a
              JOIN workplaces w ON w.id = a.workplace_id
              WHERE a.employee_id = e.id
              ORDER BY a.work_date DESC
              LIMIT 1
            ) workplace_name
     FROM leave_requests r
     JOIN employees e ON e.id = r.employee_id
     WHERE r.id = ?`,
    input.requestId,
  );
  return mapTeamRequest(refreshed!);
}

export async function myRequests(session: SessionContext) {
  const actor = await requireEmployee(session);
  const rows = await many(
    `SELECT * FROM leave_requests
     WHERE employee_id = ?
     ORDER BY created_at DESC`,
    actor.employeeId,
  );
  const requests = rows.map((row) => mapLeaveRequest(row));
  return {
    balanceDays: 8,
    leaveTypes: LEAVE_TYPES.filter((type) => type !== "WEEK_OFF").map((type) => ({
      value: type,
      label: leaveTypeLabel(type),
    })),
    requests,
  };
}

export async function createLeaveRequest(
  session: SessionContext,
  input: {
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    duration: RequestDuration;
    reason?: string | null;
    attachmentName?: string | null;
  },
) {
  const actor = await requireEmployee(session);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
    throw new HttpError(400, "INVALID_DATE", "Choose valid start and end dates.");
  }
  if (input.startDate > input.endDate) {
    throw new HttpError(400, "INVALID_DATE", "Start date must be on or before end date.");
  }
  const span = daysInclusive(input.startDate, input.endDate);
  if (span > 31) throw new HttpError(400, "RANGE_TOO_LARGE", "Leave can be at most 31 days.");
  if (input.duration === "HALF_DAY" && span !== 1) {
    throw new HttpError(400, "INVALID_DURATION", "Half day leave must be for a single date.");
  }
  const totalDays = input.duration === "HALF_DAY" ? 0.5 : span;
  const reason = input.reason?.trim() ? input.reason.trim().slice(0, 300) : null;
  const attachmentName = input.attachmentName?.trim()
    ? input.attachmentName.trim().slice(0, 180)
    : null;
  const id = randomUUID();
  const createdAt = nowIso();
  await run(
    `INSERT INTO leave_requests (
       id, employee_id, request_type, leave_type, start_date, end_date, duration,
       total_days, reason, attachment_name, status, created_at
     ) VALUES (?, ?, 'LEAVE', ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
    id,
    actor.employeeId,
    input.leaveType,
    input.startDate,
    input.endDate,
    input.duration,
    totalDays,
    reason,
    attachmentName,
    createdAt,
  );
  await audit(session.user.id, "LEAVE_REQUEST_CREATED", "leave_request", id, `${input.leaveType} ${input.startDate}-${input.endDate}`);
  const row = await one("SELECT * FROM leave_requests WHERE id = ?", id);
  return mapLeaveRequest(row!);
}

export async function createLeave(
  session: SessionContext,
  input: { employeeId: string; workDate: string; leaveType: LeaveType; note?: string | null },
) {
  requireAdmin(session);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) {
    throw new HttpError(400, "INVALID_DATE", "Choose a valid leave date.");
  }
  const employee = await one("SELECT id, full_name FROM employees WHERE id = ?", input.employeeId);
  if (!employee) throw new HttpError(404, "NOT_FOUND", "Employee not found.");
  const existing = await one(
    "SELECT id FROM leave_entries WHERE employee_id = ? AND work_date = ?",
    input.employeeId,
    input.workDate,
  );
  const note = input.note?.trim() ? input.note.trim().slice(0, 240) : null;
  if (existing) {
    await run(
      "UPDATE leave_entries SET leave_type = ?, note = ? WHERE id = ?",
      input.leaveType,
      note,
      text(existing, "id"),
    );
    await audit(session.user.id, "LEAVE_UPDATED", "leave", text(existing, "id"), `${text(employee, "full_name")} ${input.workDate} ${input.leaveType}`);
    return { id: text(existing, "id"), employeeId: input.employeeId, workDate: input.workDate, leaveType: input.leaveType, note };
  }
  const id = randomUUID();
  await run(
    `INSERT INTO leave_entries (id, employee_id, work_date, leave_type, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    input.employeeId,
    input.workDate,
    input.leaveType,
    note,
    nowIso(),
  );
  await audit(session.user.id, "LEAVE_CREATED", "leave", id, `${text(employee, "full_name")} ${input.workDate} ${input.leaveType}`);
  return { id, employeeId: input.employeeId, workDate: input.workDate, leaveType: input.leaveType, note };
}

export async function hrAttendance(session: SessionContext, input: { from: string; to: string }) {
  requireAdmin(session);
  const from = input.from;
  const to = input.to;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new HttpError(400, "INVALID_DATE", "Choose a valid date range.");
  }
  if (from > to) throw new HttpError(400, "INVALID_DATE", "From date must be on or before To date.");
  if (daysInclusive(from, to) > 62) {
    throw new HttpError(400, "RANGE_TOO_LARGE", "Choose a date range of 62 days or less.");
  }

  const rows = await many(
    `SELECT e.id employee_id, e.full_name, e.employee_code, e.department, e.designation, a.id assignment_id, a.work_date,
            w.name workplace_name, w.timezone, t.name shift_name, t.start_time, t.end_time,
            s.id session_id, s.status, s.check_in_at, s.check_out_at, s.arrival, s.departure, s.net_minutes,
            l.leave_type, l.note leave_note,
            cin.address_line check_in_address, cin.maps_url check_in_maps_url, cin.street_view_url check_in_street_view_url,
            cin.latitude check_in_latitude, cin.longitude check_in_longitude,
            cout.address_line check_out_address, cout.maps_url check_out_maps_url, cout.street_view_url check_out_street_view_url
     FROM shift_assignments a
     JOIN employees e ON e.id = a.employee_id
     JOIN workplaces w ON w.id = a.workplace_id
     JOIN shift_templates t ON t.id = a.shift_template_id
     LEFT JOIN attendance_sessions s ON s.assignment_id = a.id
     LEFT JOIN leave_entries l ON l.employee_id = e.id AND l.work_date = a.work_date
     LEFT JOIN attendance_events cin ON cin.session_id = s.id AND cin.event_type = 'CHECK_IN'
     LEFT JOIN attendance_events cout ON cout.session_id = s.id AND cout.event_type = 'CHECK_OUT'
     WHERE a.work_date BETWEEN ? AND ?
     ORDER BY a.work_date, e.full_name`,
    from,
    to,
  );

  const leaveOnly = await many(
    `SELECT e.id employee_id, e.full_name, e.employee_code, e.department, e.designation, l.work_date,
            l.leave_type, l.note leave_note
     FROM leave_entries l
     JOIN employees e ON e.id = l.employee_id
     WHERE l.work_date BETWEEN ? AND ?
       AND NOT EXISTS (
         SELECT 1 FROM shift_assignments a
         WHERE a.employee_id = l.employee_id AND a.work_date = l.work_date
       )
     ORDER BY l.work_date, e.full_name`,
    from,
    to,
  );

  const serverNow = new Date();
  const mapped = [
    ...rows.map((row) => {
      const timezone = text(row, "timezone");
      const checkInAt = optionalText(row, "check_in_at");
      const checkOutAt = optionalText(row, "check_out_at");
      const status = optionalText(row, "status");
      const leaveType = optionalText(row, "leave_type");
      const netMinutes = status === "CLOSED" ? optionalNum(row, "net_minutes") : checkInAt ? netMinutesBetween(checkInAt, serverNow.toISOString()) : null;
      const workDate = text(row, "work_date");
      const present = status === "CLOSED" || status === "OPEN";
      const attendanceKind = present ? "PRESENT" : leaveType ? "LEAVE" : "ABSENT";
      return {
        workDate,
        workDateLabel: formatDateLabel(workDate),
        employeeId: text(row, "employee_id"),
        employeeName: text(row, "full_name"),
        employeeCode: text(row, "employee_code"),
        department: text(row, "department"),
        designation: text(row, "designation"),
        workplaceName: text(row, "workplace_name"),
        shiftName: text(row, "shift_name"),
        shiftStart: text(row, "start_time"),
        shiftEnd: text(row, "end_time"),
        status: present ? status! : leaveType ? "LEAVE" : "NOT_CHECKED_IN",
        attendanceKind,
        leaveType,
        leaveTypeLabel: leaveType ? leaveTypeLabel(leaveType) : null,
        leaveNote: optionalText(row, "leave_note"),
        checkInLabel: checkInAt ? formatTimeInZone(checkInAt, timezone) : null,
        checkOutLabel: checkOutAt ? formatTimeInZone(checkOutAt, timezone) : null,
        arrival: optionalText(row, "arrival"),
        departure: optionalText(row, "departure"),
        netMinutes,
        hoursLabel: netMinutes === null ? null : formatDuration(netMinutes),
        checkInAddress: optionalText(row, "check_in_address"),
        checkInMapsUrl: optionalText(row, "check_in_maps_url"),
        checkInStreetViewUrl: optionalText(row, "check_in_street_view_url"),
        checkInLatitude: optionalNum(row, "check_in_latitude"),
        checkInLongitude: optionalNum(row, "check_in_longitude"),
        checkOutAddress: optionalText(row, "check_out_address"),
        checkOutMapsUrl: optionalText(row, "check_out_maps_url"),
        checkOutStreetViewUrl: optionalText(row, "check_out_street_view_url"),
      };
    }),
    ...leaveOnly.map((row) => {
      const workDate = text(row, "work_date");
      const leaveType = text(row, "leave_type");
      return {
        workDate,
        workDateLabel: formatDateLabel(workDate),
        employeeId: text(row, "employee_id"),
        employeeName: text(row, "full_name"),
        employeeCode: text(row, "employee_code"),
        department: text(row, "department"),
        designation: text(row, "designation"),
        workplaceName: "—",
        shiftName: "Leave",
        shiftStart: "—",
        shiftEnd: "—",
        status: "LEAVE",
        attendanceKind: "LEAVE" as const,
        leaveType,
        leaveTypeLabel: leaveTypeLabel(leaveType),
        leaveNote: optionalText(row, "leave_note"),
        checkInLabel: null,
        checkOutLabel: null,
        arrival: null,
        departure: null,
        netMinutes: null,
        hoursLabel: null,
        checkInAddress: null,
        checkInMapsUrl: null,
        checkInStreetViewUrl: null,
        checkInLatitude: null,
        checkInLongitude: null,
        checkOutAddress: null,
        checkOutMapsUrl: null,
        checkOutStreetViewUrl: null,
      };
    }),
  ].sort((a, b) => a.workDate.localeCompare(b.workDate) || a.employeeName.localeCompare(b.employeeName));

  const byDayMap = new Map<string, { date: string; assigned: number; present: number; late: number; absent: number; leave: number }>();
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    byDayMap.set(cursor, { date: cursor, assigned: 0, present: 0, late: 0, absent: 0, leave: 0 });
  }
  const byDepartmentMap = new Map<string, { department: string; assigned: number; present: number; late: number; leave: number }>();

  let present = 0;
  let inProgress = 0;
  let absent = 0;
  let onLeave = 0;
  let late = 0;
  let early = 0;
  let minutesTotal = 0;
  let minutesCount = 0;

  for (const row of mapped) {
    const day = byDayMap.get(row.workDate) ?? { date: row.workDate, assigned: 0, present: 0, late: 0, absent: 0, leave: 0 };
    day.assigned += 1;
    const dept = byDepartmentMap.get(row.department) ?? { department: row.department, assigned: 0, present: 0, late: 0, leave: 0 };
    dept.assigned += 1;

    if (row.attendanceKind === "PRESENT") {
      present += 1;
      day.present += 1;
      dept.present += 1;
      if (row.status === "OPEN") inProgress += 1;
    } else if (row.attendanceKind === "LEAVE") {
      onLeave += 1;
      day.leave += 1;
      dept.leave += 1;
    } else {
      absent += 1;
      day.absent += 1;
    }
    if (row.arrival === "LATE") {
      late += 1;
      day.late += 1;
      dept.late += 1;
    }
    if (row.departure === "EARLY") early += 1;
    if (row.netMinutes !== null) {
      minutesTotal += row.netMinutes;
      minutesCount += 1;
    }

    byDayMap.set(row.workDate, day);
    byDepartmentMap.set(row.department, dept);
  }

  return {
    from,
    to,
    fromLabel: formatDateLabel(from),
    toLabel: formatDateLabel(to),
    workDate: from === to ? from : undefined,
    workDateLabel: from === to ? formatDateLabel(from) : `${formatDateLabel(from)} to ${formatDateLabel(to)}`,
    serverNow: serverNow.toISOString(),
    leaveTypes: LEAVE_TYPES.map((type) => ({ value: type, label: leaveTypeLabel(type) })),
    rows: mapped,
    summary: {
      assigned: mapped.length,
      present,
      inProgress,
      absent,
      leave: onLeave,
      late,
      early,
      averageHoursLabel: minutesCount === 0 ? null : formatDuration(Math.round(minutesTotal / minutesCount)),
      byStatus: [
        { key: "PRESENT", label: "Present", count: present },
        { key: "ABSENT", label: "Absent", count: absent },
        { key: "LEAVE", label: "On leave", count: onLeave },
      ],
      byDay: [...byDayMap.values()].map((day) => ({
        ...day,
        dateLabel: formatDateLabel(day.date),
      })),
      byDepartment: [...byDepartmentMap.values()].sort((a, b) => b.present - a.present || a.department.localeCompare(b.department)),
    },
  };
}

export async function revokeDevice(session: SessionContext, deviceId: string) {
  requireAdmin(session);
  const device = await one("SELECT * FROM devices WHERE id = ?", deviceId);
  if (!device) throw new HttpError(404, "NOT_FOUND", "Device not found.");
  if (text(device, "status") === "REVOKED") return { deviceId, status: "REVOKED" };
  const employee = (await one("SELECT user_id FROM employees WHERE id = ?", text(device, "employee_id")))!;
  await transaction(async () => {
    await run("UPDATE devices SET status = 'REVOKED' WHERE id = ?", deviceId);
    await run("DELETE FROM sessions WHERE device_id = ?", deviceId);
    await audit(session.user.id, "DEVICE_REVOKED", "device", deviceId, `Reset for user ${text(employee, "user_id")}`);
  });
  return { deviceId, status: "REVOKED" };
}
