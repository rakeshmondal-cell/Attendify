import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDateLabel,
  formatDuration,
  netMinutesBetween,
  shiftBounds,
  zonedLocalToUtc,
} from "./time.js";

test("formats durations and dates the way both clients display them", () => {
  assert.equal(formatDuration(0), "0h 0m");
  assert.equal(formatDuration(540), "9h 0m");
  assert.equal(formatDuration(510), "8h 30m");
  assert.equal(formatDateLabel("2026-11-02"), "02-11-2026");
});

test("counts net minutes from the two server timestamps", () => {
  const minutes = netMinutesBetween("2026-11-02T03:30:00.000Z", "2026-11-02T12:30:00.000Z");
  assert.equal(minutes, 540);
  assert.equal(formatDuration(minutes), "9h 0m");
});

test("keeps an evening shift that crosses midnight on the shift start date", () => {
  const bounds = shiftBounds("2026-11-02", "16:00", "00:00", "Asia/Kolkata");
  assert.equal(bounds.crossesMidnight, true);
  assert.equal(bounds.startUtc.toISOString(), "2026-11-02T10:30:00.000Z");
  assert.equal(bounds.endUtc.toISOString(), "2026-11-02T18:30:00.000Z");
});

test("keeps a night shift inside one calendar date", () => {
  const bounds = shiftBounds("2026-11-02", "00:00", "08:00", "Asia/Kolkata");
  assert.equal(bounds.crossesMidnight, false);
  assert.equal(bounds.startUtc.toISOString(), "2026-11-01T18:30:00.000Z");
  assert.equal(bounds.endUtc.toISOString(), "2026-11-02T02:30:00.000Z");
});

test("converts Head Office local time to UTC", () => {
  assert.equal(zonedLocalToUtc("2026-11-02", "09:00", "Asia/Kolkata").toISOString(), "2026-11-02T03:30:00.000Z");
});
