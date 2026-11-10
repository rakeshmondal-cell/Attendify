import fs from "node:fs";
import path from "node:path";

const base = process.env.ATTENDIFY_API ?? "http://localhost:4000";
const rosterPath = process.env.ATTENDIFY_ROSTER
  ?? path.resolve(process.cwd(), "../documentation/data/employees.json");

type Json = Record<string, unknown>;

async function api(pathName: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(`${base}${pathName}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = (await response.json()) as Json;
  if (!response.ok) {
    throw new Error(`${pathName} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8")) as {
  employees: Array<{
    employeeCode: string;
    fullName: string;
    email: string;
    phone?: string | null;
    department: string;
    designation: string;
  }>;
  skipped: Array<{ employeeCode: string; fullName: string; email: string; reason: string }>;
};

const otp = await api("/auth/otp/request", { body: { email: "hr@attendify.local", purpose: "WEB" } });
const login = await api("/auth/otp/verify", {
  body: { email: "hr@attendify.local", purpose: "WEB", code: otp.devCode },
});
const token = String(login.token);

const result = await api("/hr/employees/import", {
  token,
  body: {
    employees: roster.employees.map((row) => ({
      employeeCode: row.employeeCode,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone ?? null,
      department: row.department,
      designation: row.designation,
    })),
  },
});

console.log(`Imported from ${rosterPath}`);
console.log(`Created: ${result.createdCount}`);
console.log(`Updated: ${result.updatedCount}`);
console.log(`Rejected by API: ${result.rejectedCount}`);
if (Array.isArray(result.rejected) && result.rejected.length) {
  console.log("API rejections:");
  for (const row of result.rejected as Array<{ employeeCode: string; reason: string }>) {
    console.log(`- ${row.employeeCode}: ${row.reason}`);
  }
}
if (roster.skipped.length) {
  console.log("Skipped before import (Excel issues):");
  for (const row of roster.skipped) {
    console.log(`- ${row.employeeCode} ${row.fullName}: ${row.reason}${row.email ? ` (${row.email})` : ""}`);
  }
}

const listed = await api("/hr/employees", { token });
console.log(`Employees now in Attendify: ${(listed.employees as unknown[]).length}`);
