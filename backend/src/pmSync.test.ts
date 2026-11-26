import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  backoffSeconds,
  attendanceReportWireBody,
  buildAttendanceReportPayload,
  buildTaskCreatePayload,
  buildTaskUpdatePayload,
  classifyPmWriteResponse,
  formatIstTimestamp,
  isDummyTask,
  normalizePmTaskStatus,
  pmIdempotencyKey,
  pmTaskCreateEnabled,
  pmTaskUpdateWireBody,
  postTaskCreate,
  postTaskUpdate,
  progressForPmStatus,
  readAppliedTaskUpdate,
  readCreatedTaskKey,
  taskCreateWireBody,
} from "./pmSync.js";

test("app status labels map to PM status codes", () => {
  assert.equal(normalizePmTaskStatus("Open"), "TO_DO");
  assert.equal(normalizePmTaskStatus("TO_DO"), "TO_DO");
  assert.equal(normalizePmTaskStatus("In progress"), "IN_PROGRESS");
  assert.equal(normalizePmTaskStatus("in-progress"), "IN_PROGRESS");
  assert.equal(normalizePmTaskStatus("Done"), "DONE");
  assert.equal(normalizePmTaskStatus("QA"), "QA");
});

test("dummy demo tasks are never synced", () => {
  assert.equal(isDummyTask("dummy-task-2", "ITC-001"), true);
  assert.equal(isDummyTask("TASK-003", "[DUMMY] Internal QA Sandbox"), true);
  assert.equal(isDummyTask("TASK-003", "ITC-001"), false);
});

test("task update payload matches the write contract", () => {
  const payload = buildTaskUpdatePayload({
    email: "Rakesh_Mondal@msrlimited.com",
    employeeCode: "MSR1002",
    pmEmployeeId: null,
    workDate: "2026-11-25",
    taskKey: "TASK-003",
    title: " Test task for rakesh ",
    projectName: "ITC-001",
    status: "In progress",
    workNote: "  fixed login bug  ",
    updatedAt: "2026-11-25T06:20:04.230Z",
  });
  assert.equal(payload.email, "rakesh_mondal@msrlimited.com");
  assert.equal(payload.employeeId, undefined);
  assert.equal(payload.taskKey, "TASK-003");
  assert.equal(payload.title, "Test task for rakesh");
  assert.equal(payload.project, "ITC-001");
  assert.equal(payload.status, "IN_PROGRESS");
  assert.equal(payload.progress, 50);
  assert.equal(payload.appStatus, "In progress");
  assert.equal(payload.workNote, "fixed login bug");
  const wire = pmTaskUpdateWireBody(payload);
  assert.equal(wire.employeeId, undefined);
  assert.equal(wire.progress, 50);
  assert.equal(wire.updatedAt, "2026-11-25T11:50:04+05:30");
  assert.equal("notes" in wire, false);
  assert.equal("source" in wire, false);
});

test("employeeId is sent only when Project Control already has the same code", () => {
  const matched = buildTaskUpdatePayload({
    email: "ankita@msrlimited.com",
    employeeCode: "MSR745",
    pmEmployeeId: "msr745",
    workDate: "2026-11-25",
    taskKey: "TASK-003",
    status: "Open",
    updatedAt: "2026-11-25T06:20:04.230Z",
  });
  assert.equal(matched.employeeId, "msr745");
  assert.equal(matched.progress, 0);
  const different = buildTaskUpdatePayload({
    email: "ankita@msrlimited.com",
    employeeCode: "MSR745",
    pmEmployeeId: "OTHER",
    workDate: "2026-11-25",
    taskKey: "TASK-003",
    status: "Done",
    updatedAt: "2026-11-25T06:20:04.230Z",
  });
  assert.equal(different.employeeId, undefined);
  assert.equal(different.progress, 100);
});

test("empty note becomes null", () => {
  const payload = buildTaskUpdatePayload({
    email: "a@b.com",
    employeeCode: "X1",
    workDate: "2026-11-25",
    taskKey: "T1",
    status: "Done",
    workNote: "   ",
    updatedAt: "2026-11-25T00:00:00.000Z",
  });
  assert.equal(payload.workNote, null);
  assert.equal(payload.title, null);
});

test("response classification: success, rejection, retry, give-up", () => {
  assert.deepEqual(classifyPmWriteResponse(200, { success: true, data: {}, error: null }).ok, true);
  assert.equal(classifyPmWriteResponse(204, null).ok, true);

  const rejected = classifyPmWriteResponse(200, { success: false, error: "UNKNOWN_TASK" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.retryable, false);
  assert.equal(rejected.error, "PM_REJECTED_UNKNOWN_TASK");

  for (const status of [408, 429, 500, 502, 503]) {
    const r = classifyPmWriteResponse(status, null);
    assert.equal(r.ok, false);
    assert.equal(r.retryable, true, `status ${status} should retry`);
  }
  for (const status of [400, 401, 403, 404, 409, 413, 422]) {
    const r = classifyPmWriteResponse(status, null);
    assert.equal(r.ok, false);
    assert.equal(r.retryable, false, `status ${status} should not retry`);
  }
});

test("a successful write keeps Project Control's status, not the one we sent", () => {
  const body = {
    success: true,
    data: {
      applied: true,
      duplicate: false,
      taskKey: "TASK-003",
      status: "QA",
      progress: 100,
      stillAssigned: false,
      parts: { status: "applied", progress: "applied", note: "added" },
    },
    error: null,
  };
  const result = classifyPmWriteResponse(200, body);
  assert.equal(result.ok, true);
  assert.deepEqual(readAppliedTaskUpdate(body), { status: "QA", stillAssigned: false });
});

test("progress follows status and timestamps use IST", () => {
  assert.equal(progressForPmStatus("Open"), 0);
  assert.equal(progressForPmStatus("In progress"), 50);
  assert.equal(progressForPmStatus("Done"), 100);
  assert.equal(formatIstTimestamp("2026-11-25T06:20:04.230Z"), "2026-11-25T11:50:04+05:30");
});

test("new project request carries project, title, status, note and IST time", () => {
  const payload = buildTaskCreatePayload({
    email: "Rakesh_Mondal@msrlimited.com",
    employeeCode: "MSR1002",
    pmEmployeeId: null,
    workDate: "2026-11-26",
    localKey: "NEW-1A2B3C4D",
    projectName: "  ITC-002 ",
    title: " Build the form ",
    status: "In progress",
    workNote: "Started today",
    createdAt: "2026-11-26T05:30:00.000Z",
  });
  assert.equal(payload.projectName, "ITC-002");
  assert.equal(payload.title, "Build the form");
  assert.equal(payload.status, "IN_PROGRESS");
  assert.equal(payload.progress, 50);
  assert.equal(payload.employeeId, undefined);
  const wire = taskCreateWireBody(payload);
  assert.equal(wire.email, "rakesh_mondal@msrlimited.com");
  assert.equal(wire.clientKey, "NEW-1A2B3C4D");
  assert.equal(wire.project, "ITC-002");
  assert.equal(wire.workNote, "Started today");
  assert.equal(wire.createdAt, "2026-11-26T11:00:00+05:30");
  assert.equal(wire.employeeId, undefined);
});

test("returned task key is read from the create response", () => {
  assert.equal(readCreatedTaskKey({ success: true, data: { taskKey: " TASK-010 " }, error: null }), "TASK-010");
  assert.equal(readCreatedTaskKey({ success: true, data: {}, error: null }), null);
  assert.equal(readCreatedTaskKey(null), null);
  assert.equal(
    classifyPmWriteResponse(200, { success: true, data: { taskKey: "TASK-011" }, error: null }).taskKey,
    "TASK-011",
  );
});

test("new project sending is off unless the flag is set", () => {
  const previous = process.env.PM_TASK_CREATE_ENABLED;
  try {
    delete process.env.PM_TASK_CREATE_ENABLED;
    assert.equal(pmTaskCreateEnabled(), false);
    process.env.PM_TASK_CREATE_ENABLED = "true";
    assert.equal(pmTaskCreateEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.PM_TASK_CREATE_ENABLED;
    else process.env.PM_TASK_CREATE_ENABLED = previous;
  }
});

test("new project is posted only to a local server and returns its key", async () => {
  const seen: { auth?: string; idem?: string; url?: string; body: Record<string, unknown> }[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      seen.push({
        auth: req.headers.authorization,
        idem: req.headers["idempotency-key"] as string | undefined,
        url: req.url,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { taskKey: "TASK-042" }, error: null }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const previousBase = process.env.PM_BASE_URL;
  const previousToken = process.env.PM_WRITE_TOKEN;
  process.env.PM_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.PM_WRITE_TOKEN = "local-only-token";
  try {
    const payload = buildTaskCreatePayload({
      email: "rakesh_mondal@msrlimited.com",
      employeeCode: "MSR1002",
      workDate: "2026-11-26",
      localKey: "NEW-1A2B3C4D",
      projectName: "ITC-002",
      title: "Build the form",
      status: "Open",
      createdAt: "2026-11-26T05:30:00.000Z",
    });
    const key = pmIdempotencyKey("9a3c1e44-aaaa-bbbb-cccc-000000000001", 1);
    const result = await postTaskCreate(taskCreateWireBody(payload), key);
    assert.equal(result.ok, true);
    assert.equal(result.taskKey, "TASK-042");
    assert.equal(seen[0]?.auth, "Bearer local-only-token");
    assert.equal(seen[0]?.idem, key);
    assert.equal(seen[0]?.url, "/api/integrations/attendance/tasks");
    assert.equal(seen[0]?.body.status, "TO_DO");
    assert.equal(String(process.env.PM_BASE_URL).includes("13.235.234.249"), false);
  } finally {
    if (previousBase === undefined) delete process.env.PM_BASE_URL;
    else process.env.PM_BASE_URL = previousBase;
    if (previousToken === undefined) delete process.env.PM_WRITE_TOKEN;
    else process.env.PM_WRITE_TOKEN = previousToken;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("task update is posted only to a local server", async () => {
  const seen: { auth?: string; idem?: string; url?: string; body: Record<string, unknown> }[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      seen.push({
        auth: req.headers.authorization,
        idem: req.headers["idempotency-key"] as string | undefined,
        url: req.url,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        data: { status: "QA", stillAssigned: false, applied: true },
        error: null,
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const previousBase = process.env.PM_BASE_URL;
  const previousToken = process.env.PM_WRITE_TOKEN;
  process.env.PM_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.PM_WRITE_TOKEN = "local-only-token";
  try {
    const payload = buildTaskUpdatePayload({
      email: "rakesh_mondal@msrlimited.com",
      employeeCode: "MSR1002",
      pmEmployeeId: null,
      workDate: "2026-11-25",
      taskKey: "TASK-003",
      status: "Done",
      workNote: "Wired the API, testing next",
      updatedAt: "2026-11-25T07:00:00.000Z",
    });
    const key = pmIdempotencyKey("6faec2b9-9be3-4053-ad72-972289650826", 2);
    const result = await postTaskUpdate(pmTaskUpdateWireBody(payload), key);
    assert.equal(result.ok, true);
    assert.equal(result.applied?.status, "QA");
    assert.equal(result.applied?.stillAssigned, false);
    assert.equal(seen[0]?.auth, "Bearer local-only-token");
    assert.equal(seen[0]?.idem, key);
    assert.equal(seen[0]?.url, "/api/integrations/attendance/task-updates");
    assert.equal(seen[0]?.body.status, "DONE");
    assert.equal(seen[0]?.body.progress, 100);
    assert.equal(seen[0]?.body.employeeId, undefined);
    assert.equal(String(seen[0]?.body.updatedAt).endsWith("+05:30"), true);
    assert.equal(String(process.env.PM_BASE_URL).includes("13.235.234.249"), false);
  } finally {
    if (previousBase === undefined) delete process.env.PM_BASE_URL;
    else process.env.PM_BASE_URL = previousBase;
    if (previousToken === undefined) delete process.env.PM_WRITE_TOKEN;
    else process.env.PM_WRITE_TOKEN = previousToken;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("attendance report is one record per session and omits a blank Project Control code", () => {
  const payload = buildAttendanceReportPayload({
    email: "Rakesh_Mondal@msrlimited.com",
    employeeCode: "MSR1002",
    pmEmployeeId: null,
    workDate: "2026-11-25",
    sessionId: "c6300ecf-406c-4c61-8d9d-81319e01ec0f",
    status: "CLOSED",
    checkInAt: "2026-11-25T04:15:30.515Z",
    checkOutAt: "2026-11-25T12:00:00.000Z",
    netMinutes: 464,
    workplace: "Head Office",
    updatedAt: "2026-11-25T12:00:00.000Z",
  });
  assert.equal(payload.email, "rakesh_mondal@msrlimited.com");
  assert.equal(payload.employeeId, undefined);
  assert.equal(payload.status, "CLOSED");
  const wire = attendanceReportWireBody(payload);
  assert.equal(wire.checkInAt, "2026-11-25T09:45:30+05:30");
  assert.equal(wire.checkOutAt, "2026-11-25T17:30:00+05:30");
  assert.equal(wire.netMinutes, 464);
  assert.equal(wire.workplace, "Head Office");
  assert.equal(wire.employeeId, undefined);
});

test("idempotency key stays fixed for retries and changes when the payload version changes", () => {
  const first = pmIdempotencyKey("6faec2b9-9be3-4053-ad72-972289650826", 3);
  assert.equal(pmIdempotencyKey("6faec2b9-9be3-4053-ad72-972289650826", 3), first);
  assert.notEqual(pmIdempotencyKey("6faec2b9-9be3-4053-ad72-972289650826", 4), first);
  assert.ok(first.length >= 8 && first.length <= 200);
});

test("backoff grows and is capped at 30 minutes", () => {
  assert.equal(backoffSeconds(0), 30);
  assert.ok(backoffSeconds(3) > backoffSeconds(1));
  assert.equal(backoffSeconds(50), 30 * 60);
});
