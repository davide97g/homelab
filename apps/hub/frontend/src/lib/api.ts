import type {
  ActionCatalog,
  ActionResult,
  AuditResponse,
  CatalogEntry,
  ContainersResponse,
  LogOptions,
  LogsResponse,
  NasDetail,
  Range,
  SeriesFrame,
  SeriesResponse,
  Summary,
} from "@wire";

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

/** Titles, units and which machine each panel applies to. Static on the server,
 *  fetched once here, and the reason a loading panel can say what it is loading
 *  instead of showing an anonymous grey box. */
export function fetchCatalog(signal?: AbortSignal): Promise<CatalogEntry[]> {
  return fetch("/api/catalog", { ...same, signal }).then((r) => json<CatalogEntry[]>(r));
}

export type SeriesStream = {
  /** Called once per panel, as soon as that panel's queries come back. */
  onFrame: (frame: SeriesFrame) => void;
  onDone: () => void;
  /** Any failure of the stream itself. The caller falls back to the batched
   *  endpoint rather than showing an error, because one is not worse than the
   *  other once the answers are cached. */
  onError: (reason: string) => void;
};

/** The same frames as `fetchSeries`, arriving one at a time.
 *
 *  Used for the first paint of a window only. `EventSource` carries the session
 *  cookie on a same-origin request and reconnects on its own, which is exactly
 *  what is not wanted here -- the server closes the stream when it has sent
 *  everything -- so `done` closes it before the browser can retry.
 *
 *  Returns the closer. */
export function streamSeries(
  ids: string[],
  range: Range,
  instance: "homelab" | "nas",
  handlers: SeriesStream,
): () => void {
  const q = new URLSearchParams({ ids: ids.join(","), range, instance });
  const source = new EventSource(`/api/series/stream?${q}`);
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };

  source.addEventListener("frame", (event) => {
    try {
      handlers.onFrame(JSON.parse((event as MessageEvent<string>).data) as SeriesFrame);
    } catch {
      // A frame that will not parse is one panel, not the page.
    }
  });

  source.addEventListener("done", () => {
    close();
    handlers.onDone();
  });

  // Fires both for a transport failure and for the server's own `error` event.
  // Either way the stream is over; only the message differs.
  source.addEventListener("error", (event) => {
    const data = (event as MessageEvent<unknown>).data;
    close();
    handlers.onError(typeof data === "string" && data ? data : "the live stream dropped");
  });

  return close;
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

export function fetchContainers(signal?: AbortSignal): Promise<ContainersResponse> {
  return fetch("/api/containers", { ...same, signal }).then((r) => json<ContainersResponse>(r));
}

export function fetchActions(signal?: AbortSignal): Promise<ActionCatalog> {
  return fetch("/api/actions", { ...same, signal }).then((r) => json<ActionCatalog>(r));
}

export function fetchAudit(signal?: AbortSignal): Promise<AuditResponse> {
  return fetch("/api/actions/log", { ...same, signal }).then((r) => json<AuditResponse>(r));
}

/** The only write in the client. `key` is generated by the caller and reused
 *  across retries of the same intent — see server/src/actions/dispatch.ts for
 *  what it buys. A refusal comes back 200 with ok: false, so this rejects only
 *  on a transport failure. */
export function runAction(body: {
  action: string;
  target?: string;
  key: string;
  confirm?: boolean;
}): Promise<ActionResult> {
  return fetch("/api/actions", {
    ...same,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<ActionResult>(r));
}
