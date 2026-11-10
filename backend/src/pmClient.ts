export const WORK_LIST_MESSAGE = "Please fill the work list for the day.";

export type WorkListStatusKind = "UPDATED" | "PENDING" | "UNAVAILABLE";

export type PmUserRow = {
  employeeId?: unknown;
  email?: unknown;
  name?: unknown;
  openTaskCount?: unknown;
  progressUpdatedToday?: unknown;
  tasks?: unknown;
};

export type PmTasksResponse = {
  date?: unknown;
  workingDay?: unknown;
  users?: unknown;
};

/** PM portal wraps the payload as `{ success, data, error }`. Flat payloads are also accepted. */
export function unwrapPmTasksPayload(raw: unknown): { response: PmTasksResponse | null; error: string | null } {
  if (!raw || typeof raw !== "object") {
    return { response: null, error: "PM_PAYLOAD_INVALID" };
  }
  const body = raw as Record<string, unknown>;
  if ("success" in body || "data" in body) {
    if (body.success === false) {
      const err = body.error;
      const detail =
        typeof err === "string"
          ? err
          : err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "PM_SUCCESS_FALSE";
      return { response: null, error: detail.slice(0, 64) || "PM_SUCCESS_FALSE" };
    }
    const data = body.data;
    if (!data || typeof data !== "object") {
      return { response: null, error: "PM_DATA_MISSING" };
    }
    return { response: data as PmTasksResponse, error: null };
  }
  return { response: body as PmTasksResponse, error: null };
}

export type WorkListResolveInput = {
  workDate: string;
  employeeEmail: string;
  employeeCode: string;
  response: PmTasksResponse | null;
  fetchError?: string | null;
};

export type WorkListResolveResult = {
  status: WorkListStatusKind;
  reason: string;
  matched: boolean;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCode(value: string): string {
  return value.trim();
}

/** Pure matcher + status rules — unit-tested without HTTP. */
export function resolveWorkListStatus(input: WorkListResolveInput): WorkListResolveResult {
  if (input.fetchError || !input.response) {
    return { status: "UNAVAILABLE", reason: input.fetchError ?? "NO_RESPONSE", matched: false };
  }
  const body = input.response;
  const responseDate = typeof body.date === "string" ? body.date.trim() : "";
  if (responseDate !== input.workDate) {
    return { status: "UNAVAILABLE", reason: "DATE_MISMATCH", matched: false };
  }
  if (body.workingDay === false) {
    return { status: "UPDATED", reason: "NON_WORKING_DAY", matched: false };
  }
  if (body.workingDay !== true) {
    return { status: "UNAVAILABLE", reason: "WORKING_DAY_INVALID", matched: false };
  }
  if (!Array.isArray(body.users)) {
    return { status: "UNAVAILABLE", reason: "USERS_INVALID", matched: false };
  }

  const email = normalizeEmail(input.employeeEmail);
  const code = normalizeCode(input.employeeCode);
  const match = (body.users as PmUserRow[]).find((row) => {
    const rowEmail = typeof row.email === "string" ? normalizeEmail(row.email) : "";
    const rowId = typeof row.employeeId === "string" || typeof row.employeeId === "number"
      ? normalizeCode(String(row.employeeId))
      : "";
    return rowEmail === email && rowId === code;
  });

  if (!match) {
    return { status: "UNAVAILABLE", reason: "EMPLOYEE_UNMATCHED", matched: false };
  }

  if (match.progressUpdatedToday === true) {
    return { status: "UPDATED", reason: "PROGRESS_UPDATED", matched: true };
  }
  if (match.progressUpdatedToday === false) {
    return { status: "PENDING", reason: "PROGRESS_PENDING", matched: true };
  }
  return { status: "UNAVAILABLE", reason: "PROGRESS_FLAG_INVALID", matched: true };
}

function pmConfigured(): boolean {
  return Boolean((process.env.PM_BASE_URL ?? "").trim());
}

export function pmWebAppUrl(): string | null {
  const url = (process.env.PM_WEB_APP_URL ?? "").trim();
  return url || null;
}

export async function fetchPmAttendanceTasks(workDate: string): Promise<{
  response: PmTasksResponse | null;
  error: string | null;
}> {
  if (!pmConfigured()) {
    return { response: null, error: "PM_NOT_CONFIGURED" };
  }
  const base = (process.env.PM_BASE_URL ?? "").replace(/\/+$/, "");
  const timeoutMs = Math.max(1000, Number(process.env.WORK_LIST_PM_TIMEOUT_MS ?? 4000));
  const url = `${base}/api/integrations/attendance/tasks?date=${encodeURIComponent(workDate)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const bearer = (process.env.PM_BEARER_TOKEN ?? "").trim();
  const apiKey = (process.env.PM_API_KEY ?? "").trim();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  else if (apiKey) headers["X-API-Key"] = apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (!res.ok) {
      return { response: null, error: `PM_HTTP_${res.status}` };
    }
    const json = await res.json();
    return unwrapPmTasksPayload(json);
  } catch (error) {
    const code = error instanceof Error && error.name === "AbortError" ? "PM_TIMEOUT" : "PM_FETCH_FAILED";
    return { response: null, error: code };
  } finally {
    clearTimeout(timer);
  }
}

export async function evaluateWorkListForEmployee(input: {
  workDate: string;
  employeeEmail: string;
  employeeCode: string;
}): Promise<WorkListResolveResult & { message: string | null; pmWebUrl: string | null }> {
  const fetched = await fetchPmAttendanceTasks(input.workDate);
  const resolved = resolveWorkListStatus({
    workDate: input.workDate,
    employeeEmail: input.employeeEmail,
    employeeCode: input.employeeCode,
    response: fetched.response,
    fetchError: fetched.error,
  });
  return {
    ...resolved,
    message: resolved.status === "PENDING" ? WORK_LIST_MESSAGE : null,
    pmWebUrl: pmWebAppUrl(),
  };
}
