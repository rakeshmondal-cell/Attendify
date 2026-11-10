/** Prefer same host as the HR page (LAN phone/PC), fall back to localhost for desktop. */
export const API_BASE =
  typeof window !== "undefined" && window.location.hostname && window.location.hostname !== "localhost"
    ? `http://${window.location.hostname}:4000`
    : "http://127.0.0.1:4000";

export class ApiError extends Error {}

export async function api<T>(path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new ApiError(payload.message ?? "The request could not be completed.");
  return payload as T;
}
