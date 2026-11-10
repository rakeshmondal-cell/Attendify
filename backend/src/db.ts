import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

type SqlValue = string | number | null;
export type SqlRow = Record<string, string | number | null | bigint>;

function loadEnvFile(): void {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const config = {
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "attendify",
  password: process.env.MYSQL_PASSWORD ?? "Attendify_Dev_2026!",
  database: process.env.MYSQL_DATABASE ?? "attendify",
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
  timezone: "Z",
  dateStrings: true,
};

export const pool: Pool = mysql.createPool(config);

const connectionStore = new AsyncLocalStorage<PoolConnection>();

function executor(): Pool | PoolConnection {
  return connectionStore.getStore() ?? pool;
}

function normalizeRows(rows: RowDataPacket[]): SqlRow[] {
  return rows.map((row) => {
    const out: SqlRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Date) out[key] = value.toISOString();
      else if (typeof value === "boolean") out[key] = value ? 1 : 0;
      else out[key] = value as string | number | null | bigint;
    }
    return out;
  });
}

export async function one(sql: string, ...params: SqlValue[]): Promise<SqlRow | undefined> {
  const [rows] = await executor().execute<RowDataPacket[]>(sql, params);
  return normalizeRows(rows)[0];
}

export async function many(sql: string, ...params: SqlValue[]): Promise<SqlRow[]> {
  const [rows] = await executor().execute<RowDataPacket[]>(sql, params);
  return normalizeRows(rows);
}

export async function run(sql: string, ...params: SqlValue[]): Promise<void> {
  await executor().execute<ResultSetHeader>(sql, params);
}

export async function transaction<T>(work: () => Promise<T>): Promise<T> {
  if (connectionStore.getStore()) return work();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await connectionStore.run(connection, work);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function text(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Expected text in ${key}`);
  return value;
}

export function num(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  if (typeof value !== "number") throw new Error(`Expected number in ${key}`);
  return value;
}

export function optionalText(row: SqlRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Expected text in ${key}`);
  return value;
}

export function optionalNum(row: SqlRow, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  if (typeof value !== "number") throw new Error(`Expected number in ${key}`);
  return value;
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(160) NOT NULL UNIQUE,
  role VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  CONSTRAINT users_role_chk CHECK (role IN ('ADMIN', 'EMPLOYEE')),
  CONSTRAINT users_status_chk CHECK (status IN ('ACTIVE', 'INACTIVE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employees (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL UNIQUE,
  employee_code VARCHAR(32) NOT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  department VARCHAR(80) NOT NULL,
  designation VARCHAR(120) NOT NULL,
  phone VARCHAR(40) NULL,
  created_at VARCHAR(40) NOT NULL,
  CONSTRAINT employees_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workplaces (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  timezone VARCHAR(64) NOT NULL,
  latitude DOUBLE NOT NULL,
  longitude DOUBLE NOT NULL,
  radius_meters INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shift_templates (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  start_time VARCHAR(8) NOT NULL,
  end_time VARCHAR(8) NOT NULL,
  grace_minutes INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shift_assignments (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  workplace_id VARCHAR(64) NOT NULL,
  shift_template_id VARCHAR(64) NOT NULL,
  work_date VARCHAR(10) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  UNIQUE KEY shift_assignments_employee_date (employee_id, work_date),
  CONSTRAINT shift_assignments_employee_fk FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT shift_assignments_workplace_fk FOREIGN KEY (workplace_id) REFERENCES workplaces(id),
  CONSTRAINT shift_assignments_shift_fk FOREIGN KEY (shift_template_id) REFERENCES shift_templates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  public_key_spki TEXT NOT NULL,
  label VARCHAR(80) NOT NULL,
  biometric_bound TINYINT NOT NULL,
  status VARCHAR(16) NOT NULL,
  passcode_hash VARCHAR(256) NULL,
  passcode_salt VARCHAR(128) NULL,
  passcode_version INT NOT NULL DEFAULT 0,
  failed_passcode_attempts INT NOT NULL DEFAULT 0,
  passcode_locked_until VARCHAR(40) NULL,
  setup_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_PASSCODE_EMAIL',
  pending_passcode_hash VARCHAR(256) NULL,
  fcm_token TEXT NULL,
  fcm_updated_at VARCHAR(40) NULL,
  created_at VARCHAR(40) NOT NULL,
  CONSTRAINT devices_employee_fk FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT devices_status_chk CHECK (status IN ('ACTIVE', 'REVOKED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS otp_challenges (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(160) NOT NULL,
  purpose VARCHAR(32) NOT NULL,
  code_hash VARCHAR(128) NOT NULL,
  expires_at VARCHAR(40) NOT NULL,
  attempts INT NOT NULL,
  consumed_at VARCHAR(40) NULL,
  created_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tokens (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  device_id VARCHAR(64) NULL,
  expires_at VARCHAR(40) NOT NULL,
  used_at VARCHAR(40) NULL,
  created_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS device_challenges (
  id VARCHAR(64) PRIMARY KEY,
  device_id VARCHAR(64) NOT NULL,
  nonce VARCHAR(128) NOT NULL,
  expires_at VARCHAR(40) NOT NULL,
  verified_at VARCHAR(40) NULL,
  created_at VARCHAR(40) NOT NULL,
  CONSTRAINT device_challenges_device_fk FOREIGN KEY (device_id) REFERENCES devices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at VARCHAR(40) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  assignment_id VARCHAR(64) NOT NULL UNIQUE,
  workplace_id VARCHAR(64) NOT NULL,
  check_in_at VARCHAR(40) NOT NULL,
  check_out_at VARCHAR(40) NULL,
  check_in_request_id VARCHAR(80) NOT NULL UNIQUE,
  check_out_request_id VARCHAR(80) NULL UNIQUE,
  status VARCHAR(16) NOT NULL,
  arrival VARCHAR(32) NOT NULL,
  departure VARCHAR(32) NULL,
  net_minutes INT NULL,
  created_at VARCHAR(40) NOT NULL,
  CONSTRAINT attendance_sessions_employee_fk FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT attendance_sessions_assignment_fk FOREIGN KEY (assignment_id) REFERENCES shift_assignments(id),
  CONSTRAINT attendance_sessions_workplace_fk FOREIGN KEY (workplace_id) REFERENCES workplaces(id),
  CONSTRAINT attendance_sessions_status_chk CHECK (status IN ('OPEN', 'CLOSED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_events (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  employee_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(16) NOT NULL,
  server_time VARCHAR(40) NOT NULL,
  latitude DOUBLE NOT NULL,
  longitude DOUBLE NOT NULL,
  accuracy_meters DOUBLE NOT NULL,
  address_line VARCHAR(500) NULL,
  maps_url VARCHAR(500) NULL,
  street_view_url VARCHAR(500) NULL,
  request_id VARCHAR(80) NOT NULL UNIQUE,
  CONSTRAINT attendance_events_session_fk FOREIGN KEY (session_id) REFERENCES attendance_sessions(id),
  CONSTRAINT attendance_events_employee_fk FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT attendance_events_type_chk CHECK (event_type IN ('CHECK_IN', 'CHECK_OUT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  actor_user_id VARCHAR(64) NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NULL,
  detail TEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS designations (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  created_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_entries (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  work_date VARCHAR(10) NOT NULL,
  leave_type VARCHAR(32) NOT NULL,
  note VARCHAR(240) NULL,
  created_at VARCHAR(40) NOT NULL,
  UNIQUE KEY leave_entries_employee_date (employee_id, work_date),
  CONSTRAINT leave_entries_employee_fk FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_requests (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  request_type VARCHAR(32) NOT NULL,
  leave_type VARCHAR(32) NULL,
  start_date VARCHAR(10) NOT NULL,
  end_date VARCHAR(10) NOT NULL,
  duration VARCHAR(16) NOT NULL,
  total_days DECIMAL(5,2) NOT NULL,
  reason VARCHAR(300) NULL,
  attachment_name VARCHAR(180) NULL,
  status VARCHAR(16) NOT NULL,
  review_note VARCHAR(500) NULL,
  reviewed_by VARCHAR(64) NULL,
  reviewed_at VARCHAR(40) NULL,
  created_at VARCHAR(40) NOT NULL,
  KEY leave_requests_employee_idx (employee_id),
  CONSTRAINT leave_requests_employee_fk FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT leave_requests_status_chk CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT leave_requests_duration_chk CHECK (duration IN ('HALF_DAY', 'FULL_DAY'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_list_reminders (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  assignment_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  work_date VARCHAR(10) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  due_at VARCHAR(40) NOT NULL,
  status VARCHAR(24) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at VARCHAR(40) NULL,
  last_error_code VARCHAR(64) NULL,
  delivery_id VARCHAR(64) NOT NULL,
  claim_token VARCHAR(64) NULL,
  skip_reason VARCHAR(64) NULL,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY work_list_reminders_employee_date_kind (employee_id, work_date, kind),
  UNIQUE KEY work_list_reminders_delivery (delivery_id),
  KEY work_list_reminders_due_idx (status, due_at, next_attempt_at),
  CONSTRAINT work_list_reminders_employee_fk FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT work_list_reminders_kind_chk CHECK (kind IN ('FOUR_HOUR_PUSH')),
  CONSTRAINT work_list_reminders_status_chk CHECK (status IN ('PENDING', 'CLAIMED', 'SENT', 'SKIPPED', 'FAILED_TERMINAL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export async function initDatabase(): Promise<void> {
  for (const statement of schemaSql.split(";").map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }

  const columns = await many(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'employees'`,
    config.database,
  );
  if (!columns.some((row) => text(row, "name") === "phone")) {
    await run("ALTER TABLE employees ADD COLUMN phone VARCHAR(40) NULL");
  }

  const eventColumns = await many(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attendance_events'`,
    config.database,
  );
  const eventNames = new Set(eventColumns.map((row) => text(row, "name")));
  if (!eventNames.has("address_line")) {
    await run("ALTER TABLE attendance_events ADD COLUMN address_line VARCHAR(500) NULL");
  }
  if (!eventNames.has("maps_url")) {
    await run("ALTER TABLE attendance_events ADD COLUMN maps_url VARCHAR(500) NULL");
  }
  if (!eventNames.has("street_view_url")) {
    await run("ALTER TABLE attendance_events ADD COLUMN street_view_url VARCHAR(500) NULL");
  }

  const employeeColumns = await many(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'employees'`,
    config.database,
  );
  if (!employeeColumns.some((row) => text(row, "name") === "is_manager")) {
    await run("ALTER TABLE employees ADD COLUMN is_manager TINYINT(1) NOT NULL DEFAULT 0");
  }
  const addedManagerId = !employeeColumns.some((row) => text(row, "name") === "manager_id");
  if (addedManagerId) {
    await run("ALTER TABLE employees ADD COLUMN manager_id VARCHAR(64) NULL");
  }
  // Add FK only once (ignore if it already exists).
  try {
    await run(
      `ALTER TABLE employees
       ADD CONSTRAINT employees_manager_fk
       FOREIGN KEY (manager_id) REFERENCES employees(id)
       ON DELETE SET NULL`,
    );
  } catch {
    // Constraint already present.
  }

  const leaveRequestColumns = await many(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'leave_requests'`,
    config.database,
  );
  const leaveRequestNames = new Set(leaveRequestColumns.map((row) => text(row, "name")));
  if (leaveRequestNames.size > 0) {
    if (!leaveRequestNames.has("review_note")) {
      await run("ALTER TABLE leave_requests ADD COLUMN review_note VARCHAR(500) NULL");
    }
    if (!leaveRequestNames.has("reviewed_by")) {
      await run("ALTER TABLE leave_requests ADD COLUMN reviewed_by VARCHAR(64) NULL");
    }
    if (!leaveRequestNames.has("reviewed_at")) {
      await run("ALTER TABLE leave_requests ADD COLUMN reviewed_at VARCHAR(40) NULL");
    }
  }

  const deviceColumns = await many(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'devices'`,
    config.database,
  );
  const deviceNames = new Set(deviceColumns.map((row) => text(row, "name")));
  if (!deviceNames.has("passcode_hash")) {
    await run("ALTER TABLE devices ADD COLUMN passcode_hash VARCHAR(256) NULL");
  }
  if (!deviceNames.has("passcode_salt")) {
    await run("ALTER TABLE devices ADD COLUMN passcode_salt VARCHAR(128) NULL");
  }
  if (!deviceNames.has("passcode_version")) {
    await run("ALTER TABLE devices ADD COLUMN passcode_version INT NOT NULL DEFAULT 0");
  }
  if (!deviceNames.has("failed_passcode_attempts")) {
    await run("ALTER TABLE devices ADD COLUMN failed_passcode_attempts INT NOT NULL DEFAULT 0");
  }
  if (!deviceNames.has("passcode_locked_until")) {
    await run("ALTER TABLE devices ADD COLUMN passcode_locked_until VARCHAR(40) NULL");
  }
  if (!deviceNames.has("setup_status")) {
    await run("ALTER TABLE devices ADD COLUMN setup_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_PASSCODE_EMAIL'");
  }
  if (!deviceNames.has("pending_passcode_hash")) {
    await run("ALTER TABLE devices ADD COLUMN pending_passcode_hash VARCHAR(256) NULL");
  }
  if (!deviceNames.has("fcm_token")) {
    await run("ALTER TABLE devices ADD COLUMN fcm_token TEXT NULL");
  }
  if (!deviceNames.has("fcm_updated_at")) {
    await run("ALTER TABLE devices ADD COLUMN fcm_updated_at VARCHAR(40) NULL");
  }
  // Existing active devices without a passcode must complete the new setup once.
  await run(
    `UPDATE devices
     SET setup_status = 'NEEDS_SETUP'
     WHERE status = 'ACTIVE'
       AND (passcode_hash IS NULL OR passcode_hash = '')`,
  );

  // Ensure at least one manager exists for Team approvals testing.
  let manager = await one("SELECT id FROM employees WHERE is_manager = 1 ORDER BY created_at ASC LIMIT 1");
  if (!manager) {
    await run(
      `UPDATE employees SET is_manager = 1
       WHERE id = (SELECT id FROM (SELECT id FROM employees ORDER BY created_at ASC LIMIT 1) t)`,
    );
    manager = await one("SELECT id FROM employees WHERE is_manager = 1 ORDER BY created_at ASC LIMIT 1");
  }
  // Bootstrap reporting lines once: only when nobody has a manager_id yet.
  if (manager) {
    const alreadyScoped = await one("SELECT id FROM employees WHERE manager_id IS NOT NULL LIMIT 1");
    if (!alreadyScoped) {
      await run(
        `UPDATE employees
         SET manager_id = ?
         WHERE manager_id IS NULL
           AND id <> ?
           AND is_manager = 0`,
        text(manager, "id"),
        text(manager, "id"),
      );
    }
  }
}

export function writeEnvExample(): void {
  const examplePath = path.join(process.cwd(), ".env.example");
  if (fs.existsSync(examplePath)) return;
  fs.writeFileSync(
    examplePath,
    `MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=attendify
MYSQL_PASSWORD=Attendify_Dev_2026!
MYSQL_DATABASE=attendify
PORT=4000

MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=maintenance@msrlimited.com
MAIL_PASSWORD=your-app-password
MAIL_FROM=maintenance@msrlimited.com
MAIL_SMTP_SSL=false
ATTENDIFY_SHOW_OTP=true
`,
    "utf8",
  );
}
