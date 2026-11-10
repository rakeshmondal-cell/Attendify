import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { initDatabase, writeEnvExample } from "./db.js";
import {
  assignShift,
  checkIn,
  checkOut,
  changeAppPasscode,
  completeActivation,
  completeLogin,
  completePasscodeReset,
  createDeviceChallenge,
  createDepartment,
  createDesignation,
  createEmployee,
  createLeave,
  deleteEmployee,
  deviceAuthStatus,
  finalizeSetup,
  getWorkListStatus,
  hrAttendance,
  hrContext,
  HttpError,
  importEmployees,
  listEmployees,
  logout,
  createLeaveRequest,
  myAttendanceHistory,
  myAttendanceToday,
  myProfile,
  myRequests,
  myShift,
  myShiftRoster,
  registerPushToken,
  requestPasscodeReset,
  reviewTeamRequest,
  teamRequests,
  readSession,
  registerDevice,
  requestOtp,
  revokeDevice,
  seed,
  unlockWithBiometric,
  unlockWithPasscode,
  updateEmployeeAccess,
  verifyDeviceChallenge,
  verifyOtp,
  verifyPasscodeReset,
} from "./domain.js";
import { startWorkListReminderWorker } from "./workListReminderWorker.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((request, response, next) => {
  const origin = request.header("origin");
  // Allow local Vite (localhost) and LAN hosts used for phone/desktop HR testing.
  if (
    origin &&
    /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/.test(origin)
  ) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});

const email = z.string().trim().email().max(160);
const purpose = z.enum(["ACTIVATION", "LOGIN", "RECOVERY", "WEB", "PASSCODE_RECOVERY"]);
const coordinate = z.number().finite();
const punch = z.object({
  requestId: z.string().trim().min(8).max(80),
  latitude: coordinate.gte(-90).lte(90),
  longitude: coordinate.gte(-180).lte(180),
  accuracyMeters: z.number().finite().gte(0).lte(5000),
  addressLine: z.string().trim().min(8).max(500),
  mapsUrl: z.string().trim().url().max(500).optional().nullable(),
  streetViewUrl: z.string().trim().url().max(500).optional().nullable(),
});

function bearer(request: Request): string | undefined {
  const header = request.header("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

function route(handler: (request: Request, response: Response) => unknown) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => handler(request, response))
      .catch(next);
  };
}

app.get("/", (_request, response) => {
  response.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Attendify API</title>
<style>body{font-family:Segoe UI,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#122}
a{color:#0b57d0}</style></head>
<body>
<h1>Attendify API</h1>
<p>This is the backend on port 4000. Open the HR website instead:</p>
<p><a href="http://127.0.0.1:5173">http://127.0.0.1:5173</a></p>
<p>Health check: <a href="/health">/health</a></p>
</body></html>`);
});

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/auth/otp/request", route(async (request, response) => {
  const body = z.object({
    email,
    purpose,
    deviceProof: z.string().optional(),
    deviceId: z.string().uuid().optional(),
  }).parse(request.body);
  response.json(await requestOtp(body.email, body.purpose, body.deviceProof, body.deviceId));
}));

app.post("/auth/otp/verify", route(async (request, response) => {
  const body = z.object({
    email,
    purpose,
    code: z.string().trim().regex(/^\d{6}$/),
    deviceProof: z.string().optional(),
    deviceId: z.string().uuid().optional(),
  }).parse(request.body);
  response.json(await verifyOtp(body.email, body.purpose, body.code, body.deviceProof, body.deviceId));
}));

app.post("/auth/devices/register", route(async (request, response) => {
  const body = z.object({
    publicKeySpki: z.string().trim().min(32).max(4000),
    label: z.string().trim().min(1).max(80),
    biometricBound: z.boolean(),
  }).parse(request.body);
  response.status(201).json(await registerDevice(bearer(request) ?? "", body.publicKeySpki, body.label, body.biometricBound));
}));

app.post("/auth/activation/complete", route(async (request, response) => {
  const body = z.object({ deviceId: z.string().uuid() }).parse(request.body);
  response.json(await completeActivation(bearer(request) ?? "", body.deviceId));
}));

app.post("/auth/setup/finalize", route(async (request, response) => {
  const body = z.object({ deviceId: z.string().uuid() }).parse(request.body);
  response.json(await finalizeSetup(bearer(request) ?? "", body.deviceId));
}));

app.post("/auth/login/complete", route(async (request, response) => {
  const body = z.object({
    loginTicket: z.string().trim().min(16),
    deviceProof: z.string().trim().min(16),
  }).parse(request.body);
  response.json(await completeLogin(body.loginTicket, body.deviceProof));
}));

app.post("/auth/unlock/biometric", route(async (request, response) => {
  const body = z.object({ deviceProof: z.string().trim().min(16) }).parse(request.body);
  response.json(await unlockWithBiometric(body.deviceProof));
}));

app.post("/auth/unlock/passcode", route(async (request, response) => {
  const body = z.object({
    deviceId: z.string().uuid(),
    passcode: z.string().trim().min(4).max(32),
  }).parse(request.body);
  response.json(await unlockWithPasscode(body.deviceId, body.passcode));
}));

app.post("/auth/passcode/forgot/request", route(async (request, response) => {
  const body = z.object({
    email,
    deviceId: z.string().uuid(),
  }).parse(request.body);
  response.json(await requestPasscodeReset(body.email, body.deviceId));
}));

app.post("/auth/passcode/forgot/verify", route(async (request, response) => {
  const body = z.object({
    email,
    deviceId: z.string().uuid(),
    code: z.string().trim().regex(/^\d{6}$/),
  }).parse(request.body);
  response.json(await verifyPasscodeReset(body.email, body.code, body.deviceId));
}));

app.post("/auth/passcode/forgot/complete", route(async (request, response) => {
  const body = z.object({ resetTicket: z.string().trim().min(16) }).parse(request.body);
  response.json(await completePasscodeReset(body.resetTicket));
}));

app.post("/auth/passcode/change", route(async (request, response) => {
  const body = z.object({
    currentPasscode: z.string().trim().min(4).max(32),
    newPasscode: z.string().trim().min(6).max(32),
  }).parse(request.body);
  response.json(
    await changeAppPasscode(
      await readSession(bearer(request)),
      body.currentPasscode,
      body.newPasscode,
    ),
  );
}));

app.get("/auth/device/status", route(async (request, response) => {
  const deviceId = z.string().uuid().parse(String(request.query.deviceId ?? ""));
  const deviceEmail = email.parse(String(request.query.email ?? ""));
  response.json(await deviceAuthStatus(deviceId, deviceEmail));
}));

app.post("/auth/device/challenge", route(async (request, response) => {
  const body = z.object({
    deviceId: z.string().uuid(),
    email,
  }).parse(request.body);
  response.json(await createDeviceChallenge(body.deviceId, body.email));
}));

app.post("/auth/device/verify", route(async (request, response) => {
  const body = z.object({
    challengeId: z.string().uuid(),
    signature: z.string().trim().min(8).max(2000),
  }).parse(request.body);
  response.json(await verifyDeviceChallenge(body.challengeId, body.signature));
}));

app.post("/auth/logout", route(async (request, response) => {
  await logout(bearer(request));
  response.json({ ok: true });
}));

app.get("/me", route(async (request, response) => {
  response.json(await myProfile(await readSession(bearer(request))));
}));

app.post("/me/devices/push-token", route(async (request, response) => {
  const body = z.object({ token: z.string().trim().min(20).max(4096) }).parse(request.body);
  response.json(await registerPushToken(await readSession(bearer(request)), body.token));
}));

app.get("/me/work-list/status", route(async (request, response) => {
  response.json(await getWorkListStatus(await readSession(bearer(request))));
}));

app.get("/me/shift", route(async (request, response) => {
  response.json(await myShift(await readSession(bearer(request))));
}));

app.get("/me/shift/roster", route(async (request, response) => {
  const weekStart = String(request.query.weekStart ?? "").trim() || null;
  response.json(await myShiftRoster(await readSession(bearer(request)), { weekStart }));
}));

app.get("/me/attendance", route(async (request, response) => {
  response.json(await myAttendanceToday(await readSession(bearer(request))));
}));

app.get("/me/attendance/history", route(async (request, response) => {
  const month = String(request.query.month ?? "").trim();
  response.json(await myAttendanceHistory(await readSession(bearer(request)), { month }));
}));

app.get("/me/requests", route(async (request, response) => {
  response.json(await myRequests(await readSession(bearer(request))));
}));

app.post("/me/requests/leave", route(async (request, response) => {
  const body = z.object({
    leaveType: z.enum(["CASUAL", "SICK", "EARNED", "ANNUAL", "UNPAID", "WEEK_OFF", "OTHER"]),
    startDate: z.string().trim(),
    endDate: z.string().trim(),
    duration: z.enum(["HALF_DAY", "FULL_DAY"]),
    reason: z.string().trim().max(300).optional().nullable(),
    attachmentName: z.string().trim().max(180).optional().nullable(),
  }).parse(request.body);
  response.status(201).json(await createLeaveRequest(await readSession(bearer(request)), body));
}));

app.get("/me/team/requests", route(async (request, response) => {
  response.json(await teamRequests(await readSession(bearer(request))));
}));

app.post("/me/team/requests/:id/review", route(async (request, response) => {
  const body = z.object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    reviewNote: z.string().trim().max(500).optional().nullable(),
  }).parse(request.body);
  response.json(
    await reviewTeamRequest(await readSession(bearer(request)), {
      requestId: String(request.params.id),
      decision: body.decision,
      reviewNote: body.reviewNote,
    }),
  );
}));

app.post("/attendance/check-in", route(async (request, response) => {
  const body = punch.parse(request.body);
  response.status(201).json(await checkIn(await readSession(bearer(request)), body));
}));

app.post("/attendance/check-out", route(async (request, response) => {
  const body = punch.parse(request.body);
  response.json(await checkOut(await readSession(bearer(request)), body));
}));

app.get("/hr/context", route(async (request, response) => {
  response.json(await hrContext(await readSession(bearer(request))));
}));

app.get("/hr/employees", route(async (request, response) => {
  response.json({ employees: await listEmployees(await readSession(bearer(request))) });
}));

app.post("/hr/employees", route(async (request, response) => {
  const body = z.object({
    fullName: z.string().trim().min(2).max(120),
    email,
    employeeCode: z.string().trim().min(2).max(32),
    department: z.string().trim().min(2).max(80),
    designation: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).optional().nullable(),
    isManager: z.boolean().optional(),
    managerId: z.string().uuid().optional().nullable(),
  }).parse(request.body);
  response.status(201).json(await createEmployee(await readSession(bearer(request)), body));
}));

app.post("/hr/employees/:id/access", route(async (request, response) => {
  const body = z.object({
    isManager: z.boolean(),
    managerId: z.string().uuid().optional().nullable(),
  }).parse(request.body);
  response.json(
    await updateEmployeeAccess(await readSession(bearer(request)), {
      employeeId: String(request.params.id),
      isManager: body.isManager,
      managerId: body.managerId,
    }),
  );
}));

app.post("/hr/employees/:id/delete", route(async (request, response) => {
  response.json(await deleteEmployee(await readSession(bearer(request)), String(request.params.id)));
}));

app.post("/hr/departments", route(async (request, response) => {
  const body = z.object({ name: z.string().trim().min(2).max(80) }).parse(request.body);
  response.status(201).json(await createDepartment(await readSession(bearer(request)), body.name));
}));

app.post("/hr/designations", route(async (request, response) => {
  const body = z.object({ name: z.string().trim().min(2).max(120) }).parse(request.body);
  response.status(201).json(await createDesignation(await readSession(bearer(request)), body.name));
}));

app.post("/hr/employees/import", route(async (request, response) => {
  const body = z.object({
    employees: z.array(z.object({
      fullName: z.string().trim().min(2).max(120),
      email,
      employeeCode: z.string().trim().min(2).max(32),
      department: z.string().trim().min(1).max(80),
      designation: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(40).optional().nullable(),
    })).min(1).max(500),
  }).parse(request.body);
  response.json(await importEmployees(await readSession(bearer(request)), body.employees));
}));

app.post("/hr/shift-assignments", route(async (request, response) => {
  const body = z.object({
    employeeId: z.string().uuid(),
    workplaceId: z.string().min(2).max(80),
    shiftTemplateId: z.string().min(2).max(80),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(request.body);
  response.status(201).json(await assignShift(await readSession(bearer(request)), body));
}));

app.get("/hr/attendance", route(async (request, response) => {
  const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const single = typeof request.query.date === "string" ? dateSchema.parse(request.query.date) : undefined;
  const from = dateSchema.parse(request.query.from ?? single);
  const to = dateSchema.parse(request.query.to ?? single ?? request.query.from);
  response.json(await hrAttendance(await readSession(bearer(request)), { from, to }));
}));

app.post("/hr/leaves", route(async (request, response) => {
  const body = z.object({
    employeeId: z.string().uuid(),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    leaveType: z.enum(["CASUAL", "SICK", "EARNED", "ANNUAL", "UNPAID", "WEEK_OFF", "OTHER"]),
    note: z.string().trim().max(240).optional().nullable(),
  }).parse(request.body);
  response.status(201).json(await createLeave(await readSession(bearer(request)), body));
}));

app.post("/hr/devices/:id/revoke", route(async (request, response) => {
  response.json(await revokeDevice(await readSession(bearer(request)), z.string().uuid().parse(request.params.id)));
}));

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.code, message: error.message });
    return;
  }
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: "INVALID_BODY", message: "Check the entered details and try again." });
    return;
  }
  console.error(error);
  response.status(500).json({ error: "SERVER_ERROR", message: "Something went wrong. Try again." });
});

const port = Number(process.env.PORT ?? 4000);

writeEnvExample();
await initDatabase();
await seed();
startWorkListReminderWorker();
app.listen(port, "0.0.0.0", () => {
  console.log(`Attendify API listening on http://0.0.0.0:${port}`);
  console.log(`Phone / LAN: use http://<this-pc-wifi-ip>:${port}`);
  console.log(`MySQL database: ${process.env.MYSQL_DATABASE ?? "attendify"}`);
});
