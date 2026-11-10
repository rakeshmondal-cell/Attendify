const base = process.env.ATTENDIFY_API ?? "http://localhost:4000";

type Json = Record<string, unknown>;

async function api(path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = (await response.json()) as Json;
  return { status: response.status, body };
}

function assertOk(status: number, expected: number, body: Json, label: string) {
  if (status !== expected) {
    throw new Error(`${label} expected ${expected} but got ${status}: ${JSON.stringify(body)}`);
  }
}

const { generateKeyPairSync, sign } = await import("node:crypto");
const { randomUUID } = await import("node:crypto");

const hrOtp = await api("/auth/otp/request", { body: { email: "hr@attendify.local", purpose: "WEB" } });
assertOk(hrOtp.status, 200, hrOtp.body, "hr otp");
const hrLogin = await api("/auth/otp/verify", {
  body: { email: "hr@attendify.local", purpose: "WEB", code: hrOtp.body.devCode },
});
assertOk(hrLogin.status, 200, hrLogin.body, "hr login");
const hrToken = String(hrLogin.body.token);

const context = await api("/hr/context", { token: hrToken });
assertOk(context.status, 200, context.body, "context");
const workplaces = context.body.workplaces as Array<{ id: string; latitude: number; longitude: number }>;
const shifts = context.body.shifts as Array<{ id: string; name: string }>;
const today = String(context.body.today);
const headOffice = workplaces[0];
const general = shifts.find((shift) => shift.name === "General shift");
if (!headOffice || !general) throw new Error("Seed data missing");

const stamp = Date.now().toString().slice(-6);
const email = `sagar.${stamp}@example.com`;
const created = await api("/hr/employees", {
  method: "POST",
  token: hrToken,
  body: {
    fullName: "Sagar Chowdhury",
    email,
    employeeCode: `EMP-${stamp}`,
    department: "Operations",
    designation: "Associate",
  },
});
assertOk(created.status, 201, created.body, "create employee");

const assigned = await api("/hr/shift-assignments", {
  method: "POST",
  token: hrToken,
  body: {
    employeeId: created.body.id,
    workplaceId: headOffice.id,
    shiftTemplateId: general.id,
    workDate: today,
  },
});
assertOk(assigned.status, 201, assigned.body, "assign shift");

const activationOtp = await api("/auth/otp/request", { body: { email, purpose: "ACTIVATION" } });
assertOk(activationOtp.status, 200, activationOtp.body, "activation otp");
const activation = await api("/auth/otp/verify", {
  body: { email, purpose: "ACTIVATION", code: activationOtp.body.devCode },
});
assertOk(activation.status, 200, activation.body, "activation verify");

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKeySpki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const registered = await api("/auth/devices/register", {
  token: String(activation.body.activationToken),
  body: { publicKeySpki, label: "Journey phone", biometricBound: false },
});
assertOk(registered.status, 201, registered.body, "register device");
const session = await api("/auth/activation/complete", {
  token: String(activation.body.activationToken),
  body: { deviceId: registered.body.deviceId },
});
assertOk(session.status, 200, session.body, "complete activation");
const employeeToken = String(session.body.token);

const remotePlace = {
  latitude: 22.6,
  longitude: 88.5,
  accuracyMeters: 12,
  addressLine: "12 Sample Street, Salt Lake, Kolkata, West Bengal 700091, India",
  mapsUrl: "https://www.google.com/maps?q=22.6,88.5",
  streetViewUrl: "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=22.6,88.5",
};

const missingAddress = await api("/attendance/check-in", {
  token: employeeToken,
  body: { requestId: randomUUID(), latitude: 22.6, longitude: 88.5, accuracyMeters: 12, addressLine: "short" },
});
assertOk(missingAddress.status, 400, missingAddress.body, "address too short rejected by schema");

const poorGps = await api("/attendance/check-in", {
  token: employeeToken,
  body: { requestId: randomUUID(), ...remotePlace, accuracyMeters: 250 },
});
assertOk(poorGps.status, 422, poorGps.body, "poor gps");

const earlyCheckout = await api("/attendance/check-out", {
  token: employeeToken,
  body: { requestId: randomUUID(), ...remotePlace },
});
assertOk(earlyCheckout.status, 409, earlyCheckout.body, "checkout without checkin");

const requestId = randomUUID();
const punch = {
  requestId,
  ...remotePlace,
};
const first = await api("/attendance/check-in", { token: employeeToken, body: punch });
assertOk(first.status, 201, first.body, "check in from anywhere with full address");
const second = await api("/attendance/check-in", {
  token: employeeToken,
  body: { ...punch, requestId: randomUUID() },
});
assertOk(second.status, 201, second.body, "duplicate check in");
if (second.body.sessionId !== first.body.sessionId) throw new Error("Double tap created two sessions");

const checkedOut = await api("/attendance/check-out", {
  token: employeeToken,
  body: { requestId: randomUUID(), ...remotePlace },
});
assertOk(checkedOut.status, 200, checkedOut.body, "check out");

const mine = await api("/me/attendance", { token: employeeToken });
assertOk(mine.status, 200, mine.body, "my attendance");
const mineAttendance = mine.body.attendance as Json;
const board = await api(`/hr/attendance?date=${today}`, { token: hrToken });
assertOk(board.status, 200, board.body, "hr attendance");
const row = (board.body.rows as Json[]).find((item) => item.employeeCode === created.body.employeeCode);
if (!row) throw new Error("HR board is missing the employee");
if (row.hoursLabel !== mineAttendance.hoursLabel || row.netMinutes !== mineAttendance.netMinutes) {
  throw new Error(`Hours differ. Employee ${mineAttendance.hoursLabel} / HR ${row.hoursLabel}`);
}
if (row.checkInLabel !== mineAttendance.checkInLabel || row.checkOutLabel !== mineAttendance.checkOutLabel) {
  throw new Error("Punch times differ between the employee and HR");
}

const challenge = await api("/auth/device/challenge", { body: { deviceId: registered.body.deviceId, email } });
assertOk(challenge.status, 200, challenge.body, "device challenge");
const signature = sign("sha256", Buffer.from(String(challenge.body.nonce), "base64url"), privateKey).toString("base64");
const proof = await api("/auth/device/verify", { body: { challengeId: challenge.body.challengeId, signature } });
assertOk(proof.status, 200, proof.body, "device proof");
const loginOtp = await api("/auth/otp/request", { body: { email, purpose: "LOGIN", deviceProof: proof.body.deviceProof } });
assertOk(loginOtp.status, 200, loginOtp.body, "login otp");
const loggedIn = await api("/auth/otp/verify", {
  body: { email, purpose: "LOGIN", code: loginOtp.body.devCode, deviceProof: proof.body.deviceProof },
});
assertOk(loggedIn.status, 200, loggedIn.body, "returning login");

console.log(`Journey matched at ${row.hoursLabel} (${row.checkInLabel} to ${row.checkOutLabel}) for ${email}`);
