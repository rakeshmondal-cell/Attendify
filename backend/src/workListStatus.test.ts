import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveWorkListStatus, unwrapPmTasksPayload, WORK_LIST_MESSAGE } from "./pmClient.js";

const baseUser = {
  employeeId: "E100",
  email: "ada@example.com",
  name: "Ada Lovelace",
  openTaskCount: 2,
  progressUpdatedToday: false,
  tasks: [{ id: 1 }, { id: 2 }],
};

describe("resolveWorkListStatus", () => {
  it("marks PENDING only when date matches, working day, email+code match, and progressUpdatedToday is false", () => {
    const result = resolveWorkListStatus({
      workDate: "2026-11-04",
      employeeEmail: "Ada@Example.com",
      employeeCode: "E100",
      response: { date: "2026-11-04", workingDay: true, users: [baseUser] },
    });
    assert.equal(result.status, "PENDING");
    assert.equal(result.matched, true);
    assert.equal(WORK_LIST_MESSAGE, "Please fill the work list for the day.");
  });

  it("marks UPDATED when progressUpdatedToday is true", () => {
    const result = resolveWorkListStatus({
      workDate: "2026-11-04",
      employeeEmail: "ada@example.com",
      employeeCode: "E100",
      response: {
        date: "2026-11-04",
        workingDay: true,
        users: [{ ...baseUser, progressUpdatedToday: true }],
      },
    });
    assert.equal(result.status, "UPDATED");
  });

  it("marks UPDATED on non-working day without treating as pending", () => {
    const result = resolveWorkListStatus({
      workDate: "2026-11-04",
      employeeEmail: "ada@example.com",
      employeeCode: "E100",
      response: { date: "2026-11-04", workingDay: false, users: [baseUser] },
    });
    assert.equal(result.status, "UPDATED");
    assert.equal(result.reason, "NON_WORKING_DAY");
  });

  it("does not match by display name alone", () => {
    const result = resolveWorkListStatus({
      workDate: "2026-11-04",
      employeeEmail: "other@example.com",
      employeeCode: "OTHER",
      response: {
        date: "2026-11-04",
        workingDay: true,
        users: [{ ...baseUser, name: "Other Person" }],
      },
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.reason, "EMPLOYEE_UNMATCHED");
  });

  it("requires both email and employee code", () => {
    const emailOnly = resolveWorkListStatus({
      workDate: "2026-11-04",
      employeeEmail: "ada@example.com",
      employeeCode: "WRONG",
      response: { date: "2026-11-04", workingDay: true, users: [baseUser] },
    });
    assert.equal(emailOnly.status, "UNAVAILABLE");

    const codeOnly = resolveWorkListStatus({
      workDate: "2026-11-04",
      employeeEmail: "wrong@example.com",
      employeeCode: "E100",
      response: { date: "2026-11-04", workingDay: true, users: [baseUser] },
    });
    assert.equal(codeOnly.status, "UNAVAILABLE");
  });

  it("treats wrong response date as unavailable", () => {
    const result = resolveWorkListStatus({
      workDate: "2026-11-04",
      employeeEmail: "ada@example.com",
      employeeCode: "E100",
      response: { date: "2026-11-03", workingDay: true, users: [baseUser] },
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.reason, "DATE_MISMATCH");
  });

  it("treats missing progress flag as unavailable (never false-remind)", () => {
    const result = resolveWorkListStatus({
      workDate: "2026-11-04",
      employeeEmail: "ada@example.com",
      employeeCode: "E100",
      response: {
        date: "2026-11-04",
        workingDay: true,
        users: [{ ...baseUser, progressUpdatedToday: "no" }],
      },
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.reason, "PROGRESS_FLAG_INVALID");
  });

  it("treats fetch errors as unavailable", () => {
    const result = resolveWorkListStatus({
      workDate: "2026-11-04",
      employeeEmail: "ada@example.com",
      employeeCode: "E100",
      response: null,
      fetchError: "PM_TIMEOUT",
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.reason, "PM_TIMEOUT");
  });

  it("ignores openTaskCount vs tasks.length for the decision", () => {
    const result = resolveWorkListStatus({
      workDate: "2026-11-04",
      employeeEmail: "ada@example.com",
      employeeCode: "E100",
      response: {
        date: "2026-11-04",
        workingDay: true,
        users: [{ ...baseUser, openTaskCount: 99, tasks: [], progressUpdatedToday: true }],
      },
    });
    assert.equal(result.status, "UPDATED");
  });
});

describe("unwrapPmTasksPayload", () => {
  it("reads fields from the Project Control { success, data } envelope", () => {
    const unwrapped = unwrapPmTasksPayload({
      success: true,
      data: { date: "2026-11-05", workingDay: true, users: [baseUser] },
      error: null,
    });
    assert.equal(unwrapped.error, null);
    assert.equal(unwrapped.response?.date, "2026-11-05");
    assert.equal(unwrapped.response?.workingDay, true);
  });

  it("accepts a flat payload for compatibility", () => {
    const unwrapped = unwrapPmTasksPayload({ date: "2026-11-05", workingDay: false, users: [] });
    assert.equal(unwrapped.error, null);
    assert.equal(unwrapped.response?.workingDay, false);
  });

  it("surfaces success:false as unavailable", () => {
    const unwrapped = unwrapPmTasksPayload({ success: false, data: null, error: "Unauthorized" });
    assert.equal(unwrapped.response, null);
    assert.equal(unwrapped.error, "Unauthorized");
  });
});
