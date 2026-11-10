import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";

type Screen = "employees" | "attendance";

type Workplace = { id: string; name: string; timezone: string };
type ShiftTemplate = { id: string; name: string; startTime: string; endTime: string; crossesMidnight: boolean };
type Device = { id: string; label: string; status: string; biometricBound: boolean };
type Employee = {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string;
  department: string;
  designation: string;
  phone?: string | null;
  status: string;
  isManager?: boolean;
  accessRole?: "MANAGER" | "EMPLOYEE";
  managerId?: string | null;
  managerName?: string | null;
  devices: Device[];
};
type CatalogItem = { id: string; name: string };
type Context = {
  today: string;
  todayLabel: string;
  workplaces: Workplace[];
  shifts: ShiftTemplate[];
  departments: CatalogItem[];
  designations: CatalogItem[];
};
type AttendanceRow = {
  workDate: string;
  workDateLabel: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  designation: string;
  workplaceName: string;
  shiftName: string;
  shiftStart: string;
  shiftEnd: string;
  status: string;
  attendanceKind: "PRESENT" | "ABSENT" | "LEAVE";
  leaveType: string | null;
  leaveTypeLabel: string | null;
  leaveNote: string | null;
  checkInLabel: string | null;
  checkOutLabel: string | null;
  arrival: string | null;
  departure: string | null;
  netMinutes: number | null;
  hoursLabel: string | null;
  checkInAddress?: string | null;
  checkInMapsUrl?: string | null;
  checkInStreetViewUrl?: string | null;
  checkOutAddress?: string | null;
  checkOutMapsUrl?: string | null;
  checkOutStreetViewUrl?: string | null;
};
type AttendanceSummary = {
  assigned: number;
  present: number;
  inProgress: number;
  absent: number;
  leave: number;
  late: number;
  early: number;
  averageHoursLabel: string | null;
  byStatus: Array<{ key: string; label: string; count: number }>;
  byDay: Array<{ date: string; dateLabel: string; assigned: number; present: number; late: number; absent: number; leave: number }>;
  byDepartment: Array<{ department: string; assigned: number; present: number; late: number; leave: number }>;
};

const LEAVE_TYPE_OPTIONS = [
  { value: "CASUAL", label: "Casual leave" },
  { value: "SICK", label: "Sick leave" },
  { value: "EARNED", label: "Earned leave" },
  { value: "UNPAID", label: "Unpaid leave" },
  { value: "WEEK_OFF", label: "Week off" },
  { value: "OTHER", label: "Other leave" },
] as const;

function isoFromParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function mondayOfDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay(); // 0 Sun .. 6 Sat
  const offset = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + offset);
  return isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function toWeekValue(iso: string): string {
  const monday = mondayOfDate(iso);
  const thursday = addDaysIso(monday, 3);
  const isoYear = Number(thursday.slice(0, 4));
  const week1Monday = mondayOfDate(isoFromParts(isoYear, 1, 4));
  const [my, mm, md] = monday.split("-").map(Number);
  const [wy, wm, wd] = week1Monday.split("-").map(Number);
  const diffDays = Math.round((Date.UTC(my, mm - 1, md) - Date.UTC(wy, wm - 1, wd)) / 86_400_000);
  const isoWeek = Math.floor(diffDays / 7) + 1;
  return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

function rangeFromWeekValue(weekValue: string): { from: string; to: string } | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekValue);
  if (!match) return null;
  const isoYear = Number(match[1]);
  const isoWeek = Number(match[2]);
  const week1Monday = mondayOfDate(isoFromParts(isoYear, 1, 4));
  const from = addDaysIso(week1Monday, (isoWeek - 1) * 7);
  return { from, to: addDaysIso(from, 6) };
}

const tokenKey = "attendify-hr-token";

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey));
  if (!token) return <Login onSuccess={setToken} />;
  return <Portal token={token} onSignOut={() => { sessionStorage.removeItem(tokenKey); setToken(null); }} />;
}

function Login({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [email, setEmail] = useState("mithun_roy@msrlimited.com");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setInfo(null);
    try {
      const result = await api<{ devCode?: string; message?: string; mailed?: boolean }>("/auth/otp/request", {
        body: { email, purpose: "WEB" },
      });
      setDevCode(result.devCode ?? null);
      setCodeSent(true);
      setInfo(
        result.devCode
          ? "Use the development code below (email delivery is not returning codes in the API)."
          : result.message || "Enter the 6-digit code sent to your work email.",
      );
    } catch (caught) {
      setCodeSent(false);
      setError(caught instanceof ApiError ? caught.message : "The code could not be sent.");
    } finally {
      setPending(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api<{ token: string }>("/auth/otp/verify", {
        body: { email, purpose: "WEB", code },
      });
      sessionStorage.setItem(tokenKey, result.token);
      onSuccess(result.token);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The code could not be verified.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-screen">
      <form className="card login-card" onSubmit={codeSent ? verify : sendCode}>
        <div className="brand">ATTENDIFY</div>
        <h1>HR sign-in</h1>
        <p className="muted">Sign in with Mithun’s HR email, then the 6-digit code.</p>
        <label>
          Work email
          <input
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setCodeSent(false);
              setDevCode(null);
              setInfo(null);
            }}
            type="email"
            required
            disabled={codeSent && pending}
          />
        </label>
        {codeSent && (
          <>
            {devCode && (
              <div className="dev-code">
                Development code
                <div><strong>{devCode}</strong></div>
                Email delivery is not connected on this machine, so the code is shown here.
              </div>
            )}
            {info && !devCode && <p className="muted">{info}</p>}
            <label>
              6-digit code
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                pattern="\d{6}"
                autoComplete="one-time-code"
                required
                autoFocus
              />
            </label>
            <button
              type="button"
              className="linkish"
              disabled={pending}
              onClick={() => {
                setCodeSent(false);
                setCode("");
                setDevCode(null);
                setInfo(null);
                setError(null);
              }}
            >
              Use a different email / resend
            </button>
          </>
        )}
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={pending || (codeSent && code.length !== 6)} type="submit">
          {codeSent ? "Sign in" : "Send code"}
        </button>
      </form>
    </main>
  );
}

function Portal({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [screen, setScreen] = useState<Screen>("employees");
  const [context, setContext] = useState<Context | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const [nextContext, nextEmployees] = await Promise.all([
        api<Context>("/hr/context", { token }),
        api<{ employees: Employee[] }>("/hr/employees", { token }),
      ]);
      setContext(nextContext);
      setEmployees(nextEmployees.employees);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.message === "Sign in to continue.") onSignOut();
      setError(caught instanceof ApiError ? caught.message : "The portal could not be loaded.");
    }
  }

  useEffect(() => { void reload(); }, [token]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">ATTENDIFY</div>
        <h1>HR</h1>
        <nav>
          <button className={screen === "employees" ? "active" : ""} onClick={() => setScreen("employees")}>Employees</button>
          <button className={screen === "attendance" ? "active" : ""} onClick={() => setScreen("attendance")}>Attendance</button>
        </nav>
        <button className="ghost signout" onClick={onSignOut}>Sign out</button>
      </aside>
      <main className="content">
        {error && <div className="error">{error}</div>}
        {context && screen === "employees" && (
          <Employees token={token} context={context} employees={employees} onChange={reload} />
        )}
        {context && screen === "attendance" && (
          <Attendance token={token} context={context} employees={employees} />
        )}
      </main>
    </div>
  );
}

function Employees({
  token,
  context,
  employees,
  onChange,
}: {
  token: string;
  context: Context;
  employees: Employee[];
  onChange: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [department, setDepartment] = useState(context.departments[0]?.name ?? "");
  const [designation, setDesignation] = useState(context.designations[0]?.name ?? "");
  const [departments, setDepartments] = useState(context.departments);
  const [designations, setDesignations] = useState(context.designations);
  const [newDepartment, setNewDepartment] = useState("");
  const [newDesignation, setNewDesignation] = useState("");
  const [creatingDepartment, setCreatingDepartment] = useState(false);
  const [creatingDesignation, setCreatingDesignation] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [managerId, setManagerId] = useState("");
  const [savingAccessId, setSavingAccessId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const managers = useMemo(
    () => employees.filter((row) => row.isManager),
    [employees],
  );

  useEffect(() => {
    setDepartments(context.departments);
    setDesignations(context.designations);
    if (!department && context.departments[0]) setDepartment(context.departments[0].name);
    if (!designation && context.designations[0]) setDesignation(context.designations[0].name);
  }, [context, department, designation]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api("/hr/employees", {
        token,
        body: {
          fullName,
          email,
          employeeCode,
          department,
          designation,
          isManager,
          managerId: managerId || null,
        },
      });
      setMessage(`${fullName.trim()} can activate the Android app with ${email.trim().toLowerCase()}.`);
      setFullName("");
      setEmail("");
      setEmployeeCode("");
      setIsManager(false);
      setManagerId("");
      await onChange();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The employee could not be created.");
    }
  }

  async function saveAccess(employee: Employee, next: { isManager: boolean; managerId: string | null }) {
    setError(null);
    setMessage(null);
    setSavingAccessId(employee.id);
    try {
      await api(`/hr/employees/${employee.id}/access`, {
        method: "POST",
        token,
        body: next,
      });
      setMessage(`Access updated for ${employee.fullName}.`);
      await onChange();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Access could not be updated.");
    } finally {
      setSavingAccessId(null);
    }
  }

  async function saveDepartment() {
    setError(null);
    try {
      const result = await api<{ name: string; departments: CatalogItem[] }>("/hr/departments", {
        token,
        body: { name: newDepartment },
      });
      setDepartments(result.departments);
      setDepartment(result.name);
      setNewDepartment("");
      setCreatingDepartment(false);
      await onChange();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The department could not be created.");
    }
  }

  async function saveDesignation() {
    setError(null);
    try {
      const result = await api<{ name: string; designations: CatalogItem[] }>("/hr/designations", {
        token,
        body: { name: newDesignation },
      });
      setDesignations(result.designations);
      setDesignation(result.name);
      setNewDesignation("");
      setCreatingDesignation(false);
      await onChange();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The designation could not be created.");
    }
  }

  async function revoke(deviceId: string) {
    setError(null);
    try {
      await api(`/hr/devices/${deviceId}/revoke`, { method: "POST", token, body: {} });
      await onChange();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The device could not be reset.");
    }
  }

  async function removeEmployee(employee: Employee) {
    if (!window.confirm(`Delete ${employee.fullName}? They will no longer be able to sign in.`)) return;
    setError(null);
    setMessage(null);
    try {
      await api(`/hr/employees/${employee.id}/delete`, { method: "POST", token, body: {} });
      setMessage(`${employee.fullName} was deleted.`);
      await onChange();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The employee could not be deleted.");
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Employees</h1>
          <p className="muted">
            {employees.length} active accounts. Add people with the form, or delete anyone you no longer need.
          </p>
        </div>
      </div>
      <div className="grid">
        <form className="panel" onSubmit={create}>
          <h2>New employee</h2>
          <label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label>
          <label>Work email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Employee code<input value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} required /></label>
          <label>
            Department
            <select
              value={creatingDepartment ? "__new__" : department}
              onChange={(event) => {
                if (event.target.value === "__new__") {
                  setCreatingDepartment(true);
                  return;
                }
                setCreatingDepartment(false);
                setDepartment(event.target.value);
              }}
              required={!creatingDepartment}
            >
              {departments.length === 0 && <option value="">Select department</option>}
              {departments.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              <option value="__new__">+ Create new department</option>
            </select>
          </label>
          {creatingDepartment && (
            <div className="inline-create">
              <input
                value={newDepartment}
                onChange={(event) => setNewDepartment(event.target.value)}
                placeholder="New department name"
                required
              />
              <button className="ghost" type="button" onClick={() => void saveDepartment()}>Save</button>
              <button className="ghost" type="button" onClick={() => { setCreatingDepartment(false); setNewDepartment(""); }}>Cancel</button>
            </div>
          )}
          <label>
            Designation
            <select
              value={creatingDesignation ? "__new__" : designation}
              onChange={(event) => {
                if (event.target.value === "__new__") {
                  setCreatingDesignation(true);
                  return;
                }
                setCreatingDesignation(false);
                setDesignation(event.target.value);
              }}
              required={!creatingDesignation}
            >
              {designations.length === 0 && <option value="">Select designation</option>}
              {designations.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              <option value="__new__">+ Create new designation</option>
            </select>
          </label>
          {creatingDesignation && (
            <div className="inline-create">
              <input
                value={newDesignation}
                onChange={(event) => setNewDesignation(event.target.value)}
                placeholder="New designation name"
                required
              />
              <button className="ghost" type="button" onClick={() => void saveDesignation()}>Save</button>
              <button className="ghost" type="button" onClick={() => { setCreatingDesignation(false); setNewDesignation(""); }}>Cancel</button>
            </div>
          )}
          <label className="check-row">
            <input type="checkbox" checked={isManager} onChange={(event) => setIsManager(event.target.checked)} />
            Grant Manager access (Team approvals)
          </label>
          <label>
            Reporting manager
            <select value={managerId} onChange={(event) => setManagerId(event.target.value)}>
              <option value="">Unassigned</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.fullName} · {manager.employeeCode}
                </option>
              ))}
            </select>
          </label>
          {error && <div className="error">{error}</div>}
          {message && <div className="ok">{message}</div>}
          <button className="primary" type="submit" disabled={creatingDepartment || creatingDesignation || !department || !designation}>
            Create employee
          </button>
        </form>
        <section className="panel">
          {employees.length === 0 && <p className="empty">No employees yet.</p>}
          {employees.map((employee) => (
            <article className="employee" key={employee.id}>
              <div className="employee-head">
                <strong>{employee.fullName}</strong>
                <button className="danger" type="button" onClick={() => void removeEmployee(employee)}>
                  Delete
                </button>
              </div>
              <div className="meta">{employee.employeeCode} · {employee.department} · {employee.designation}</div>
              <div className="meta">{employee.email}{employee.phone ? ` · ${employee.phone}` : ""}</div>
              <div className="meta">
                Role: {employee.isManager ? "Manager" : "Employee"}
                {employee.managerName ? ` · Reports to ${employee.managerName}` : " · No reporting manager"}
              </div>
              <div className="access-row">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={Boolean(employee.isManager)}
                    disabled={savingAccessId === employee.id}
                    onChange={(event) =>
                      void saveAccess(employee, {
                        isManager: event.target.checked,
                        managerId: employee.managerId ?? null,
                      })
                    }
                  />
                  Manager
                </label>
                <label>
                  Reports to
                  <select
                    value={employee.managerId ?? ""}
                    disabled={savingAccessId === employee.id}
                    onChange={(event) =>
                      void saveAccess(employee, {
                        isManager: Boolean(employee.isManager),
                        managerId: event.target.value || null,
                      })
                    }
                  >
                    <option value="">Unassigned</option>
                    {managers
                      .filter((manager) => manager.id !== employee.id)
                      .map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.fullName}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {employee.devices.length === 0 && <div className="meta">No phone registered</div>}
              {employee.devices.map((device) => (
                <div className="stack" key={device.id}>
                  <span className="meta">{device.label} · {device.status === "ACTIVE" ? "Active" : "Reset"}{device.biometricBound ? " · Fingerprint" : ""}</span>
                  {device.status === "ACTIVE" && <button className="danger" type="button" onClick={() => void revoke(device.id)}>Reset phone</button>}
                </div>
              ))}
            </article>
          ))}
        </section>
      </div>
    </>
  );
}

function AssignShift({ token, context, employees }: { token: string; context: Context; employees: Employee[] }) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [workDate, setWorkDate] = useState(context.today);
  const [shiftTemplateId, setShiftTemplateId] = useState(context.shifts[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId && employees[0]) setEmployeeId(employees[0].id);
  }, [employees, employeeId]);

  async function assign(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ workDateLabel: string }>("/hr/shift-assignments", {
        token,
        body: { employeeId, workplaceId: context.workplaces[0].id, shiftTemplateId, workDate },
      });
      const employee = employees.find((item) => item.id === employeeId);
      setMessage(`${employee?.fullName ?? "Employee"} is assigned for ${result.workDateLabel}.`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The shift could not be assigned.");
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Assign shift</h1>
          <p className="muted">Head Office uses Asia/Kolkata. A shift that passes midnight stays one attendance session.</p>
        </div>
      </div>
      <form className="panel" onSubmit={assign}>
        <label>
          Employee
          <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName} · {employee.employeeCode}</option>)}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} required />
        </label>
        <label>
          Shift
          <select value={shiftTemplateId} onChange={(event) => setShiftTemplateId(event.target.value)} required>
            {context.shifts.map((shift) => (
              <option key={shift.id} value={shift.id}>
                {shift.name} · {shift.startTime}–{shift.endTime}{shift.crossesMidnight ? " · crosses midnight" : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="meta">Workplace: {context.workplaces[0]?.name}</p>
        {error && <div className="error">{error}</div>}
        {message && <div className="ok">{message}</div>}
        <button className="primary" type="submit" disabled={employees.length === 0}>Assign shift</button>
      </form>
    </>
  );
}

function csvEscape(value: string): string {
  // Neutralize Excel formula injection and quote cells that need it.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

function statusLabel(row: AttendanceRow): string {
  if (row.attendanceKind === "LEAVE") return row.leaveTypeLabel ?? "On leave";
  if (row.status === "NOT_CHECKED_IN") return "Absent";
  if (row.status === "OPEN") return "In progress";
  return "Checked out";
}

function downloadAttendanceCsv(from: string, to: string, rows: AttendanceRow[]) {
  const headers = [
    "Date",
    "Employee",
    "Employee code",
    "Department",
    "Designation",
    "Workplace",
    "Shift",
    "Shift start",
    "Shift end",
    "Attendance",
    "Leave type",
    "Leave note",
    "Check-in",
    "Check-out",
    "Check-in address",
    "Check-in Maps",
    "Check-in Street View",
    "Check-out address",
    "Check-out Maps",
    "Check-out Street View",
    "Arrival",
    "Departure",
    "Hours",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => [
      row.workDateLabel,
      row.employeeName,
      row.employeeCode,
      row.department,
      row.designation,
      row.workplaceName,
      row.shiftName,
      row.shiftStart,
      row.shiftEnd,
      statusLabel(row),
      row.leaveTypeLabel ?? "",
      row.leaveNote ?? "",
      row.checkInLabel ?? "",
      row.checkOutLabel ?? "",
      row.checkInAddress ?? "",
      row.checkInMapsUrl ?? "",
      row.checkInStreetViewUrl ?? "",
      row.checkOutAddress ?? "",
      row.checkOutMapsUrl ?? "",
      row.checkOutStreetViewUrl ?? "",
      row.arrival ?? "",
      row.departure ?? "",
      row.hoursLabel ?? "",
    ].map(csvEscape).join(",")),
  ];
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `attendance-${from}-to-${to}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildFilteredSummary(rows: AttendanceRow[], from: string, to: string): AttendanceSummary {
  const byDayMap = new Map<string, { date: string; dateLabel: string; assigned: number; present: number; late: number; absent: number; leave: number }>();
  for (let cursor = from; cursor <= to; ) {
    const [year, month, day] = cursor.split("-").map(Number);
    const label = `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
    byDayMap.set(cursor, { date: cursor, dateLabel: label, assigned: 0, present: 0, late: 0, absent: 0, leave: 0 });
    cursor = addDaysIso(cursor, 1);
  }
  const byDepartmentMap = new Map<string, { department: string; assigned: number; present: number; late: number; leave: number }>();
  let present = 0;
  let inProgress = 0;
  let absent = 0;
  let leave = 0;
  let late = 0;
  let early = 0;
  let minutesTotal = 0;
  let minutesCount = 0;

  for (const row of rows) {
    const day = byDayMap.get(row.workDate) ?? {
      date: row.workDate,
      dateLabel: row.workDateLabel,
      assigned: 0,
      present: 0,
      late: 0,
      absent: 0,
      leave: 0,
    };
    day.assigned += 1;
    const dept = byDepartmentMap.get(row.department) ?? { department: row.department, assigned: 0, present: 0, late: 0, leave: 0 };
    dept.assigned += 1;
    if (row.attendanceKind === "PRESENT") {
      present += 1;
      day.present += 1;
      dept.present += 1;
      if (row.status === "OPEN") inProgress += 1;
    } else if (row.attendanceKind === "LEAVE") {
      leave += 1;
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

  const averageMinutes = minutesCount === 0 ? null : Math.round(minutesTotal / minutesCount);
  const hours = averageMinutes === null ? null : Math.floor(averageMinutes / 60);
  const mins = averageMinutes === null ? null : averageMinutes % 60;

  return {
    assigned: rows.length,
    present,
    inProgress,
    absent,
    leave,
    late,
    early,
    averageHoursLabel: averageMinutes === null ? null : `${hours}h ${String(mins).padStart(2, "0")}m`,
    byStatus: [
      { key: "PRESENT", label: "Present", count: present },
      { key: "ABSENT", label: "Absent", count: absent },
      { key: "LEAVE", label: "On leave", count: leave },
    ],
    byDay: [...byDayMap.values()],
    byDepartment: [...byDepartmentMap.values()].sort((a, b) => b.present - a.present || a.department.localeCompare(b.department)),
  };
}

function StatusDonut({ items }: { items: Array<{ key: string; label: string; count: number }> }) {
  const total = items.reduce((sum, item) => sum + item.count, 0) || 1;
  const colors: Record<string, string> = {
    PRESENT: "#5b46f5",
    ABSENT: "#c9bfd9",
    LEAVE: "#f0a202",
  };
  let offset = 0;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="chart-card">
      <h3>Status mix</h3>
      <div className="donut-wrap">
        <svg viewBox="0 0 120 120" className="donut">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#efeaff" strokeWidth="16" />
          {items.map((item) => {
            const length = (item.count / total) * circumference;
            const segment = (
              <circle
                key={item.key}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={colors[item.key] ?? "#5b46f5"}
                strokeWidth="16"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
              />
            );
            offset += length;
            return segment;
          })}
          <text x="60" y="56" textAnchor="middle" className="donut-total">{items.reduce((sum, item) => sum + item.count, 0)}</text>
          <text x="60" y="72" textAnchor="middle" className="donut-caption">records</text>
        </svg>
        <ul className="legend">
          {items.map((item) => (
            <li key={item.key}>
              <span className="swatch" style={{ background: colors[item.key] }} />
              {item.label}: <strong>{item.count}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DailyBars({ days }: { days: AttendanceSummary["byDay"] }) {
  const max = Math.max(1, ...days.map((day) => day.assigned));
  return (
    <div className="chart-card">
      <h3>Daily presence</h3>
      <div className="bar-chart">
        {days.map((day) => (
          <div className="bar-col" key={day.date}>
            <div className="bar-stack" title={`${day.dateLabel}: ${day.present} present / ${day.absent} absent / ${day.leave} leave`}>
              <div className="bar present" style={{ height: `${(day.present / max) * 100}%` }} />
              <div className="bar leave" style={{ height: `${(day.leave / max) * 100}%` }} />
              <div className="bar absent" style={{ height: `${(day.absent / max) * 100}%` }} />
            </div>
            <span>{day.dateLabel.slice(0, 5)}</span>
          </div>
        ))}
      </div>
      <div className="legend row">
        <span><span className="swatch" style={{ background: "#5b46f5" }} /> Present</span>
        <span><span className="swatch" style={{ background: "#f0a202" }} /> Leave</span>
        <span><span className="swatch" style={{ background: "#e4dcf8" }} /> Absent</span>
      </div>
    </div>
  );
}

function DepartmentBars({ departments }: { departments: AttendanceSummary["byDepartment"] }) {
  const top = departments.slice(0, 8);
  const max = Math.max(1, ...top.map((item) => item.assigned));
  return (
    <div className="chart-card">
      <h3>By department</h3>
      <div className="dept-bars">
        {top.length === 0 && <p className="empty">No department data in this range.</p>}
        {top.map((item) => (
          <div className="dept-row" key={item.department}>
            <div className="dept-label">
              <strong>{item.department}</strong>
              <span className="meta">{item.present} present · {item.assigned - item.present - item.leave} absent · {item.leave} leave</span>
            </div>
            <div className="dept-track">
              <div className="dept-fill" style={{ width: `${(item.present / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Attendance({
  token,
  context,
  employees,
}: {
  token: string;
  context: Context;
  employees: Employee[];
}) {
  const [from, setFrom] = useState(context.today);
  const [to, setTo] = useState(context.today);
  const [weekOf, setWeekOf] = useState(toWeekValue(context.today));
  const [department, setDepartment] = useState("ALL");
  const [designation, setDesignation] = useState("ALL");
  const [presence, setPresence] = useState("ALL");
  const [leaveType, setLeaveType] = useState("ALL");
  const [shiftName, setShiftName] = useState("ALL");
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [leaveEmployeeId, setLeaveEmployeeId] = useState(employees[0]?.id ?? "");
  const [leaveDate, setLeaveDate] = useState(context.today);
  const [leaveTypeForm, setLeaveTypeForm] = useState<string>("CASUAL");
  const [leaveNote, setLeaveNote] = useState("");
  const [leaveMessage, setLeaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!leaveEmployeeId && employees[0]) setLeaveEmployeeId(employees[0].id);
  }, [employees, leaveEmployeeId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api<{ rows: AttendanceRow[] }>(`/hr/attendance?from=${from}&to=${to}`, { token });
        if (!cancelled) {
          setRows(result.rows);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : "Attendance could not be loaded.");
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [from, to, token]);

  function applyWeek(value: string) {
    setWeekOf(value);
    const range = rangeFromWeekValue(value);
    if (!range) return;
    setFrom(range.from);
    setTo(range.to);
  }

  async function markLeave(event: FormEvent) {
    event.preventDefault();
    setLeaveMessage(null);
    setError(null);
    try {
      await api("/hr/leaves", {
        token,
        body: {
          employeeId: leaveEmployeeId,
          workDate: leaveDate,
          leaveType: leaveTypeForm,
          note: leaveNote.trim() || null,
        },
      });
      const person = employees.find((item) => item.id === leaveEmployeeId);
      setLeaveMessage(`${person?.fullName ?? "Employee"} marked on leave for ${leaveDate}.`);
      setLeaveNote("");
      const result = await api<{ rows: AttendanceRow[] }>(`/hr/attendance?from=${from}&to=${to}`, { token });
      setRows(result.rows);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Leave could not be saved.");
    }
  }

  const filtered = useMemo(() => rows.filter((row) => {
    if (department !== "ALL" && row.department !== department) return false;
    if (designation !== "ALL" && row.designation !== designation) return false;
    if (presence !== "ALL" && row.attendanceKind !== presence) return false;
    if (leaveType !== "ALL" && row.leaveType !== leaveType) return false;
    if (shiftName !== "ALL" && row.shiftName !== shiftName) return false;
    return true;
  }), [rows, department, designation, presence, leaveType, shiftName]);

  const summary = useMemo(() => buildFilteredSummary(filtered, from, to), [filtered, from, to]);
  const shiftOptions = useMemo(
    () => [...new Set(rows.map((row) => row.shiftName))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Attendance</h1>
          <p className="muted">Use week-of, absent, and leave filters with the summary charts, then download Excel (includes full address, Maps, and Street View).</p>
        </div>
        <button
          className="ghost"
          type="button"
          disabled={filtered.length === 0}
          onClick={() => downloadAttendanceCsv(from, to, filtered)}
        >
          Download Excel
        </button>
      </div>

      <section className="panel filters-panel">
        <div className="filters">
          <label>
            Week of
            <input type="week" value={weekOf} onChange={(event) => applyWeek(event.target.value)} />
          </label>
          <label>
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => {
                setFrom(event.target.value);
                setWeekOf(toWeekValue(event.target.value));
              }}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) => {
                setTo(event.target.value);
                setWeekOf(toWeekValue(event.target.value));
              }}
            />
          </label>
          <label>
            Department
            <select value={department} onChange={(event) => setDepartment(event.target.value)}>
              <option value="ALL">All departments</option>
              {context.departments.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Designation
            <select value={designation} onChange={(event) => setDesignation(event.target.value)}>
              <option value="ALL">All designations</option>
              {context.designations.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Attendance
            <select value={presence} onChange={(event) => setPresence(event.target.value)}>
              <option value="ALL">All</option>
              <option value="PRESENT">Present</option>
              <option value="ABSENT">Absent</option>
              <option value="LEAVE">Leave</option>
            </select>
          </label>
          <label>
            Leave type
            <select value={leaveType} onChange={(event) => setLeaveType(event.target.value)}>
              <option value="ALL">All leave types</option>
              {LEAVE_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            Shift
            <select value={shiftName} onChange={(event) => setShiftName(event.target.value)}>
              <option value="ALL">All shifts</option>
              {shiftOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="panel filters-panel">
        <h2>Mark leave / week off</h2>
        <form className="filters leave-form" onSubmit={markLeave}>
          <label>
            Employee
            <select value={leaveEmployeeId} onChange={(event) => setLeaveEmployeeId(event.target.value)} required>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.fullName} · {employee.employeeCode}</option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input type="date" value={leaveDate} onChange={(event) => setLeaveDate(event.target.value)} required />
          </label>
          <label>
            Leave type
            <select value={leaveTypeForm} onChange={(event) => setLeaveTypeForm(event.target.value)} required>
              {LEAVE_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            Note
            <input value={leaveNote} onChange={(event) => setLeaveNote(event.target.value)} placeholder="Optional" />
          </label>
          <div className="leave-actions">
            <button className="primary" type="submit" disabled={employees.length === 0}>Save leave</button>
          </div>
        </form>
        {leaveMessage && <div className="ok">{leaveMessage}</div>}
      </section>

      {error && <div className="error">{error}</div>}

      <section className="summary-grid summary-grid-7">
        <article className="stat-card"><span className="meta">Records</span><strong>{summary.assigned}</strong></article>
        <article className="stat-card"><span className="meta">Present</span><strong>{summary.present}</strong></article>
        <article className="stat-card"><span className="meta">Absent</span><strong>{summary.absent}</strong></article>
        <article className="stat-card"><span className="meta">Leave</span><strong>{summary.leave}</strong></article>
        <article className="stat-card"><span className="meta">Late</span><strong>{summary.late}</strong></article>
        <article className="stat-card"><span className="meta">Early exit</span><strong>{summary.early}</strong></article>
        <article className="stat-card"><span className="meta">Avg hours</span><strong>{summary.averageHoursLabel ?? "—"}</strong></article>
      </section>

      <section className="charts-grid">
        <StatusDonut items={summary.byStatus} />
        <DailyBars days={summary.byDay} />
        <DepartmentBars departments={summary.byDepartment} />
      </section>

      <section className="panel">
        <div className="table-head">
          <h2>Records</h2>
          <span className="meta">{filtered.length} shown</span>
        </div>
        {filtered.length === 0 && <p className="empty">No records match this range and filters.</p>}
        {filtered.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Employee</th>
                <th>Shift</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Location</th>
                <th>Attendance</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={`${row.workDate}-${row.employeeCode}-${row.shiftName}-${row.attendanceKind}`}>
                  <td>{row.workDateLabel}</td>
                  <td>
                    <strong>{row.employeeName}</strong>
                    <div className="meta">{row.employeeCode} · {row.department} · {row.designation}</div>
                  </td>
                  <td>{row.shiftName}<div className="meta">{row.shiftStart}–{row.shiftEnd}</div></td>
                  <td>{row.checkInLabel ?? "—"}{row.arrival && <div><span className={row.arrival === "LATE" ? "pill late" : "pill"}>{row.arrival === "LATE" ? "Late" : "On time"}</span></div>}</td>
                  <td>{row.checkOutLabel ?? "—"}{row.departure === "EARLY" && <div><span className="pill early">Early</span></div>}</td>
                  <td>
                    {row.checkInAddress ? (
                      <>
                        <div>{row.checkInAddress}</div>
                        <div className="meta stack">
                          {row.checkInMapsUrl && <a href={row.checkInMapsUrl} target="_blank" rel="noreferrer">Map</a>}
                          {row.checkInStreetViewUrl && <a href={row.checkInStreetViewUrl} target="_blank" rel="noreferrer">Street View</a>}
                        </div>
                      </>
                    ) : "—"}
                    {row.checkOutAddress && (
                      <div className="meta" style={{ marginTop: 8 }}>
                        Out: {row.checkOutAddress}{" "}
                        {row.checkOutMapsUrl && <a href={row.checkOutMapsUrl} target="_blank" rel="noreferrer">Map</a>}
                        {" "}
                        {row.checkOutStreetViewUrl && <a href={row.checkOutStreetViewUrl} target="_blank" rel="noreferrer">Street View</a>}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`pill ${row.attendanceKind === "PRESENT" ? (row.status === "OPEN" ? "open" : "closed") : row.attendanceKind === "LEAVE" ? "leave" : ""}`}>
                      {statusLabel(row)}
                    </span>
                    <div>{row.hoursLabel ?? row.leaveNote ?? ""}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
