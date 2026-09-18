import type { LogOptions, LogsResponse, NasDetail, Range, SeriesResponse, Summary } from "@wire";

// Types come from the server's wire.ts through the @wire alias, so there is no
// second copy to keep in step. Only the calls live here.

export class Unauthorized extends Error {
  constructor() {
    super("unauthorized");
    this.name = "Unauthorized";
  }
}

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

const same: RequestInit = { credentials: "same-origin" };

export function fetchSummary(signal?: AbortSignal): Promise<Summary> {
  return fetch("/api/summary", { ...same, signal }).then((r) => json<Summary>(r));
}

export function fetchSession(): Promise<{ authenticated: boolean }> {
  return fetch("/api/session", same).then((r) => json<{ authenticated: boolean }>(r));
}

export function login(password: string): Promise<{ ok: true }> {
  return fetch("/api/login", {
    ...same,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  }).then((r) => json<{ ok: true }>(r));
}

export function logout(): Promise<{ ok: true }> {
  return fetch("/api/logout", { ...same, method: "POST" }).then((r) => json<{ ok: true }>(r));
}

export function fetchSeries(
  ids: string[],
  range: Range,
  instance: "homelab" | "nas",
  signal?: AbortSignal,
): Promise<SeriesResponse> {
  const q = new URLSearchParams({ ids: ids.join(","), range, instance });
  return fetch(`/api/series?${q}`, { ...same, signal }).then((r) => json<SeriesResponse>(r));
}

export function fetchNas(signal?: AbortSignal): Promise<NasDetail> {
  return fetch("/api/nas", { ...same, signal }).then((r) => json<NasDetail>(r));
}

/** Structured filters only. The server assembles the LogQL, so there is nothing
 *  here that could widen a stream selector — see server/src/loki/query.ts. */
export type LogQuery = {
  range: string;
  host?: string | null;
  container?: string | null;
  unit?: string | null;
  levels?: string[];
  contains?: string | null;
  limit?: number;
  since?: string | null;
};

export function fetchLogs(query: LogQuery, signal?: AbortSignal): Promise<LogsResponse> {
  const q = new URLSearchParams({ range: query.range });
  if (query.host) q.set("host", query.host);
  if (query.container) q.set("container", query.container);
  if (query.unit) q.set("unit", query.unit);
  if (query.levels && query.levels.length > 0) q.set("levels", query.levels.join(","));
  if (query.contains) q.set("contains", query.contains);
  if (query.limit) q.set("limit", String(query.limit));
  if (query.since) q.set("since", query.since);
  return fetch(`/api/logs?${q}`, { ...same, signal }).then((r) => json<LogsResponse>(r));
}

export function fetchLogOptions(signal?: AbortSignal): Promise<LogOptions> {
  return fetch("/api/logs/options", { ...same, signal }).then((r) => json<LogOptions>(r));
}
