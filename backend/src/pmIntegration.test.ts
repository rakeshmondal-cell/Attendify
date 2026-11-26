import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findMatchedPmUser,
  lookupPmProgress,
  mapPmUserWorkload,
  pmProgressByEmployee,
  resolveWorkListStatus,
  type PmTasksResponse,
} from "./pmClient.js";

describe("PM attendance gate helpers", () => {
  const response: PmTasksResponse = {
    date: "2026-11-13",
    workingDay: true,
    users: [
      {
        employeeId: "MSR-1024",
        email: "alex@msrlimited.com",
        progressUpdatedToday: false,
        openTaskCount: 2,
        tasks: [
          { id: "t1", title: "UI update", status: "IN_PROGRESS", projectName: "ITC Hotels App" },
          { id: "t2", title: "API test", status: "TO_DO", projectName: "ITC Hotels App" },
        ],
      },
      {
        employeeId: "MSR-1108",
        email: "priya@msrlimited.com",
        progressUpdatedToday: true,
        openTaskCount: 0,
        tasks: [],
      },
      {
        employeeId: null,
        email: "ankita_sarkar@msrlimited.com",
        progressUpdatedToday: false,
      },
    ],
  };

  it("matches employee by email + code", () => {
    const user = findMatchedPmUser(response, "Alex@msrlimited.com", "MSR-1024");
    assert.ok(user);
    assert.equal(user?.progressUpdatedToday, false);
  });

  it("matches by email only when PM employeeId is null", () => {
    const user = findMatchedPmUser(response, "ankita_sarkar@msrlimited.com", "MSR9999");
    assert.ok(user);
    assert.equal(user?.progressUpdatedToday, false);
  });

  it("rejects email match when PM employeeId is set but code differs", () => {
    const user = findMatchedPmUser(response, "alex@msrlimited.com", "WRONG-CODE");
    assert.equal(user, null);
  });

  it("maps projects and tasks from PM user row", () => {
    const user = findMatchedPmUser(response, "alex@msrlimited.com", "MSR-1024");
    const workload = mapPmUserWorkload(user);
    assert.equal(workload.projects.length, 1);
    assert.equal(workload.projects[0]?.name, "ITC Hotels App");
    assert.equal(workload.tasks.length, 2);
    assert.equal(workload.progressUpdatedToday, false);
  });

  it("builds progress map for daily report join", () => {
    const map = pmProgressByEmployee(response);
    assert.equal(map.get("MSR-1024|alex@msrlimited.com")?.progressUpdatedToday, false);
    assert.equal(map.get("MSR-1108|priya@msrlimited.com")?.progressUpdatedToday, true);
    assert.equal(
      lookupPmProgress(map, "MSR9999", "ankita_sarkar@msrlimited.com")?.progressUpdatedToday,
      false,
    );
    // Coded PM rows must not match via email-only fallback on wrong Attendify code.
    assert.equal(lookupPmProgress(map, "WRONG", "alex@msrlimited.com"), undefined);
  });

  it("keeps PENDING when progress not updated", () => {
    const resolved = resolveWorkListStatus({
      workDate: "2026-11-13",
      employeeEmail: "alex@msrlimited.com",
      employeeCode: "MSR-1024",
      response,
    });
    assert.equal(resolved.status, "PENDING");
  });

  it("resolves PENDING for email-only PM users", () => {
    const resolved = resolveWorkListStatus({
      workDate: "2026-11-13",
      employeeEmail: "ankita_sarkar@msrlimited.com",
      employeeCode: "MSR1002",
      response,
    });
    assert.equal(resolved.status, "PENDING");
    assert.equal(resolved.matched, true);
  });
});

describe("attendance write eligibility rules", () => {
  it("only OPEN sessions may write", () => {
    const canWrite = (status: string) => status === "OPEN";
    assert.equal(canWrite("OPEN"), true);
    assert.equal(canWrite("CLOSED"), false);
    assert.equal(canWrite("NONE"), false);
  });
});
