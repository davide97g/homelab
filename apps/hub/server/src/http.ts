import { config } from "./config.js";

export class ServiceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ServiceError";
  }
}

export type FetchOptions = {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  /** Cookie jar entry, for qBittorrent's session login. */
  cookie?: string;
  timeoutMs?: number;
  /** Statuses to treat as success alongside 2xx. Docker answers 304 to a start
   *  on an already-running container, which is the correct answer to an
   *  idempotent verb and must not read as a failure. */
  allowStatus?: number[];
};

/** A JSON GET with a hard timeout and an error that says which service broke.
 *  Everything upstream here is on the LAN, so a slow answer means trouble, not
 *  distance -- failing fast keeps one sick service from holding the page. */
export async function getJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await request(url, opts);
  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ServiceError(`non-JSON response from ${url}`, res.status);
  }
}

export async function request(url: string, opts: FetchOptions = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...opts.headers,
      },
      body: opts.body,
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? config.timeoutMs),
    });
  } catch (err) {
    // Node phrases an AbortSignal.timeout as "The operation was aborted due to
    // timeout", which is a sentence to print on a card. Both spellings are
    // matched: fetch's own DNS/connect failures say "timed out".
    const reason = err instanceof Error ? err.message : String(err);
    throw new ServiceError(/time(d)? ?out/i.test(reason) ? "timed out" : reason);
  }
  if (!res.ok && !(opts.allowStatus ?? []).includes(res.status)) {
    throw new ServiceError(`HTTP ${res.status}`, res.status);
  }
  return res;
}

/** Resolves to null instead of throwing. Used for the optional extras on a
 *  snapshot -- one missing endpoint should not blank out a whole node. */
export async function soft<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}
