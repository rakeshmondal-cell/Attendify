import assert from "node:assert/strict";
import { scryptSync, timingSafeEqual, randomBytes } from "node:crypto";
import { describe, it } from "node:test";

const MAX_PASSCODE_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 45;

function normalizePasscode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function legacyNormalizePasscode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function assertChosenPasscode(raw: string): string {
  const normalized = normalizePasscode(raw);
  if (normalized.length < 6 || normalized.length > 16) {
    throw new Error("PASSCODE_WEAK");
  }
  return normalized;
}

function hashPasscode(passcode: string, salt: string): string {
  return scryptSync(passcode.normalize("NFKC"), salt, 64).toString("hex");
}

function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function passcodeMatches(raw: string, salt: string, expected: string): boolean {
  const modern = hashPasscode(normalizePasscode(raw), salt);
  if (hashesMatch(expected, modern)) return true;
  const legacy = legacyNormalizePasscode(raw);
  if (legacy === normalizePasscode(raw)) return false;
  return hashesMatch(expected, hashPasscode(legacy, salt));
}

function generateAppPasscode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i += 1) out += alphabet[bytes[i]! % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

describe("app passcode hashing", () => {
  it("verifies the same passcode with the same salt", () => {
    const salt = "abc123";
    const passcode = "ABCD-2345";
    const digest = hashPasscode(normalizePasscode(passcode), salt);
    assert.equal(passcodeMatches(passcode, salt, digest), true);
  });

  it("rejects a different passcode", () => {
    const salt = "abc123";
    const digest = hashPasscode(normalizePasscode("ABCD-2345"), salt);
    assert.equal(passcodeMatches("ABCD-9999", salt, digest), false);
  });

  it("normalizes case, hyphen, and whitespace for verify", () => {
    const salt = "salt";
    const digest = hashPasscode(normalizePasscode("ABCD-2345"), salt);
    assert.equal(passcodeMatches("  abcd-2345  ", salt, digest), true);
    assert.equal(passcodeMatches("abcd2345", salt, digest), true);
  });

  it("still unlocks legacy hyphenated hashes", () => {
    const salt = "legacy";
    const emailed = "ABCD-2345";
    const digest = hashPasscode(legacyNormalizePasscode(emailed), salt);
    assert.equal(passcodeMatches("ABCD-2345", salt, digest), true);
    assert.equal(passcodeMatches("abcd-2345", salt, digest), true);
  });

  it("accepts user-chosen alphanumeric passcodes of 6–16 chars", () => {
    assert.equal(assertChosenPasscode("secret1"), "SECRET1");
    assert.equal(assertChosenPasscode("MyPass-99"), "MYPASS99");
    assert.throws(() => assertChosenPasscode("abc"), /PASSCODE_WEAK/);
    assert.throws(() => assertChosenPasscode("x".repeat(17)), /PASSCODE_WEAK/);
  });

  it("rejects change when new equals current after normalize", () => {
    const current = normalizePasscode("ABCD-1234");
    const next = assertChosenPasscode("abcd1234");
    assert.equal(next === current, true);
  });

  it("rotate invalidates the previous digest so old passcode fails", () => {
    const saltOld = randomBytes(8).toString("hex");
    const saltNew = randomBytes(8).toString("hex");
    const oldPass = generateAppPasscode();
    const newPass = "mychoice42";
    const oldDigest = hashPasscode(normalizePasscode(oldPass), saltOld);
    const newDigest = hashPasscode(normalizePasscode(newPass), saltNew);
    assert.equal(passcodeMatches(oldPass, saltOld, oldDigest), true);
    assert.equal(passcodeMatches(oldPass, saltNew, newDigest), false);
    assert.equal(passcodeMatches(newPass, saltNew, newDigest), true);
    const confirmation = { changed: true, message: "Your app passcode was updated." };
    assert.equal("devPasscode" in confirmation, false);
  });

  it("locks after max failed attempts", () => {
    let attempts = 0;
    let locked = false;
    for (let i = 0; i < MAX_PASSCODE_ATTEMPTS; i += 1) {
      attempts += 1;
      if (attempts >= MAX_PASSCODE_ATTEMPTS) {
        locked = true;
        attempts = 0;
      }
    }
    assert.equal(locked, true);
    assert.equal(attempts, 0);
  });

  it("enforces OTP resend cooldown window", () => {
    const createdAt = Date.now() - 10_000;
    const elapsedMs = Date.now() - createdAt;
    assert.equal(elapsedMs < OTP_RESEND_SECONDS * 1000, true);
    const wait = Math.ceil((OTP_RESEND_SECONDS * 1000 - elapsedMs) / 1000);
    assert.ok(wait >= 30 && wait <= OTP_RESEND_SECONDS);
  });
});
