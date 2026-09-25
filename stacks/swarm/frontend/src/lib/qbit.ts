import type { MainData, Peer, TorrentFile, Tracker } from "./types";

/* The UI is served by qBittorrent itself, so every call is same-origin: the
 * session cookie rides along automatically and no CSRF token is needed. The
 * cookie (QBT_SID_8080 on this box) is HttpOnly, so the browser cannot read it
 * -- session state is inferred from response codes alone. */

const API = "/api/v2";

/** Thrown when qBittorrent says the session is gone. Callers show the login. */
export class NeedsLogin extends Error {
  constructor() {
    super("qBittorrent wants a login");
    this.name = "NeedsLogin";
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API}${path}`, { credentials: "same-origin", ...init });
  if (res.status === 401 || res.status === 403) throw new NeedsLogin();
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res;
}

async function get<T>(path: string): Promise<T> {
  return (await request(path)).json() as Promise<T>;
}

async function post(path: string, body: Record<string, string>): Promise<void> {
  await request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

/**
 * Sign in.
 *
 * qBittorrent 5.2.3 answers a successful login with **204**, older builds with
 * 200 and the body "Ok.". A wrong password is 401 here but 200 "Fails." on 4.x.
 * So neither the status nor the body is portable, and the cookie that would
 * settle it is HttpOnly. The reliable test is simply whether an authenticated
 * endpoint answers afterwards.
 *
 * qBittorrent bans the caller for an hour after 5 failures
 * (web_ui_max_auth_fail_count), so never retry this in a loop.
 */
export async function login(username: string, password: string): Promise<boolean> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
  });
  if (res.status === 403) throw new Error("Too many failed attempts. Locked out for an hour.");
  if (!res.ok && res.status !== 204) return false;
  return authenticated();
}

export async function authenticated(): Promise<boolean> {
  const res = await fetch(`${API}/app/version`, { credentials: "same-origin" });
  return res.ok;
}

export async function logout(): Promise<void> {
  await fetch(`${API}/auth/logout`, { method: "POST", credentials: "same-origin" });
}

/**
 * The single polling call behind the whole page.
 *
 * Pass the `rid` from the previous response to receive a delta; pass 0 for a
 * full snapshot. A stale or unknown rid is harmless -- the server just replies
 * with `full_update: true` and the complete state, so the stream cannot drift
 * out of sync.
 */
export function maindata(rid: number): Promise<MainData> {
  return get<MainData>(`/sync/maindata?rid=${rid}`);
}

/* Actions. qBittorrent 5.0 renamed pause/resume to stop/start; the old routes
 * return 404 on this version. */
export const stop = (hashes: string[]) => post("/torrents/stop", { hashes: hashes.join("|") });
export const start = (hashes: string[]) => post("/torrents/start", { hashes: hashes.join("|") });

export const remove = (hashes: string[], deleteFiles: boolean) =>
  post("/torrents/delete", { hashes: hashes.join("|"), deleteFiles: String(deleteFiles) });

export const files = (hash: string) => get<TorrentFile[]>(`/torrents/files?hash=${hash}`);
export const trackers = (hash: string) => get<Tracker[]>(`/torrents/trackers?hash=${hash}`);

/** There is no /torrents/peers route -- peers live under the sync namespace. */
export async function peers(hash: string): Promise<Peer[]> {
  const data = await get<{ peers?: Record<string, Peer> }>(
    `/sync/torrentPeers?hash=${hash}&rid=0`,
  );
  return Object.values(data.peers ?? {});
}

/** Add by file, by magnet, or both. `category` and `savepath` are optional. */
export async function add(opts: {
  files?: File[];
  urls?: string;
  category?: string;
}): Promise<void> {
  const form = new FormData();
  for (const f of opts.files ?? []) form.append("torrents", f, f.name);
  if (opts.urls) form.append("urls", opts.urls);
  if (opts.category) form.append("category", opts.category);
  await request("/torrents/add", { method: "POST", body: form });
}

export function preferences(): Promise<Record<string, unknown>> {
  return get("/app/preferences");
}

export function setPreferences(prefs: Record<string, unknown>): Promise<void> {
  return post("/app/setPreferences", { json: JSON.stringify(prefs) });
}

export const toggleAltSpeed = () => post("/transfer/toggleSpeedLimitsMode", {});
