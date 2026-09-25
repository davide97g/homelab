import { ServiceError, getJson, request } from "../http.js";
import { Activity, Snapshot, bytes, down, duration, rate } from "./types.js";

type Transfer = {
  dl_info_speed?: number; up_info_speed?: number;
  dl_info_data?: number; up_info_data?: number;
  dl_rate_limit?: number; up_rate_limit?: number;
  connection_status?: string; dht_nodes?: number;
};
type Torrent = {
  hash: string; name?: string; progress?: number; state?: string;
  dlspeed?: number; upspeed?: number; size?: number; eta?: number;
  num_seeds?: number; num_leechs?: number; ratio?: number; category?: string;
};
type MainData = { server_state?: { alltime_dl?: number; alltime_ul?: number; free_space_on_disk?: number; global_ratio?: string } };

// Torrent states that mean "work is happening", as opposed to seeding or paused.
const ACTIVE = new Set(["downloading", "forcedDL", "metaDL", "stalledDL", "checkingDL", "allocating"]);
const PAUSED = new Set(["pausedDL", "pausedUP", "stoppedDL", "stoppedUP"]);

/** qBittorrent authenticates with a session cookie, not a key. The cookie is
 *  kept here and re-minted on the first 403 -- it outlives a page refresh but
 *  not a qBittorrent restart. */
let sid: string | null = null;

async function login(base: string, user: string, pass: string): Promise<string | null> {
  if (!user && !pass) return null; // localhost bypass or no auth configured
  const res = await request(`${base}/api/v2/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // qBittorrent rejects a cross-origin-looking POST unless Referer matches.
      referer: base,
      origin: base,
    },
    body: new URLSearchParams({ username: user, password: pass }).toString(),
  });
  // The cookie is the only reliable success signal across versions: qBittorrent
  // 5.2 answers 204 with an empty body, older builds answered 200 "Ok.", and a
  // bad password is 200 "Fails." either way. All three are `res.ok`.
  //
  // Its name is not stable either -- 5.x issues QBT_SID_<port>, earlier builds
  // plain SID -- so whatever pairs come back are passed through rather than
  // matched by name.
  const body = (await res.text()).trim();
  const raw = res.headers.getSetCookie?.() ?? [];
  const headers = raw.length ? raw : [res.headers.get("set-cookie") ?? ""];
  const cookies = headers
    .map((entry) => entry.split(";")[0]?.trim() ?? "")
    .filter((pair) => pair.includes("="));

  if (cookies.length === 0) {
    throw new ServiceError(
      body && body !== "Fails."
        ? `login rejected (${body})`
        : "login rejected — check QBITTORRENT_USER / QBITTORRENT_PASS",
    );
  }
  return cookies.join("; ");
}

async function call<T>(base: string, user: string, pass: string, path: string, retry = true): Promise<T> {
  if (sid === null && (user || pass)) sid = await login(base, user, pass);
  try {
    return await getJson<T>(`${base}${path}`, {
      headers: { referer: base },
      ...(sid ? { cookie: sid } : {}),
    });
  } catch (err) {
    if (retry && err instanceof ServiceError && err.status === 403) {
      sid = await login(base, user, pass);
      return call<T>(base, user, pass, path, false);
    }
    throw err;
  }
}

export async function collectQbittorrent(base: string, user: string, pass: string, link: string): Promise<Snapshot> {
  const role = "Transfers — downloads";
  const started = Date.now();
  try {
    const [transfer, torrents, main] = await Promise.all([
      call<Transfer>(base, user, pass, "/api/v2/transfer/info"),
      call<Torrent[]>(base, user, pass, "/api/v2/torrents/info?filter=all&sort=progress"),
      call<MainData>(base, user, pass, "/api/v2/sync/maindata?rid=0").catch(() => ({}) as MainData),
    ]);

    const active = torrents.filter((t) => ACTIVE.has(t.state ?? ""));
    const seeding = torrents.filter((t) => (t.state ?? "").toLowerCase().includes("up") && !PAUSED.has(t.state ?? ""));
    const errored = torrents.filter((t) => (t.state ?? "") === "error" || (t.state ?? "") === "missingFiles");
    const dl = transfer.dl_info_speed ?? 0;
    const up = transfer.up_info_speed ?? 0;
    const server = main.server_state ?? {};
    const online = (transfer.connection_status ?? "").toLowerCase() === "connected";

    const activity: Activity[] = torrents
      .slice()
      .sort((a, b) => {
        const aActive = ACTIVE.has(a.state ?? "") ? 1 : 0;
        const bActive = ACTIVE.has(b.state ?? "") ? 1 : 0;
        return bActive - aActive || (b.dlspeed ?? 0) - (a.dlspeed ?? 0);
      })
      .slice(0, 25)
      .map((t) => ({
        id: t.hash,
        title: t.name ?? t.hash.slice(0, 12),
        subtitle: [t.category, bytes(t.size ?? 0), (t.dlspeed ?? 0) > 0 ? rate(t.dlspeed ?? 0) : null, (t.eta ?? 0) > 0 && (t.eta ?? 0) < 8640000 ? `ETA ${duration(t.eta ?? 0)}` : null]
          .filter(Boolean)
          .join(" · "),
        progress: t.progress,
        state: t.state,
        tone: errored.includes(t) ? "bad" : ACTIVE.has(t.state ?? "") ? "accent" : (t.progress ?? 0) >= 1 ? "good" : "default",
        meta: `${t.num_seeds ?? 0}S / ${t.num_leechs ?? 0}L`,
      }));

    return {
      id: "qbittorrent",
      name: "qBittorrent",
      role,
      link,
      status: errored.length ? "warn" : online ? "up" : "warn",
      latencyMs: Date.now() - started,
      stats: [
        { label: "Download", value: rate(dl), tone: dl > 0 ? "accent" : "default" },
        { label: "Upload", value: rate(up), tone: up > 0 ? "good" : "default" },
        { label: "Torrents", value: String(torrents.length), hint: `${active.length} active · ${seeding.length} seeding`, tone: errored.length ? "bad" : "default" },
        { label: "Free space", value: bytes(server.free_space_on_disk ?? 0), tone: (server.free_space_on_disk ?? 0) < 50e9 ? "warn" : "good" },
        { label: "All time", value: `${bytes(server.alltime_dl ?? 0)} ↓`, hint: `${bytes(server.alltime_ul ?? 0)} ↑ · ratio ${server.global_ratio ?? "-"}` },
      ],
      flags: [{ label: transfer.connection_status ?? "unknown", on: online }],
      activityLabel: "Torrents",
      activity,
    };
  } catch (err) {
    // A 403 here is almost always the Web UI wanting a login: the dashboard
    // reaches qBittorrent from a container, so the "bypass for localhost"
    // default does not apply to it.
    const unauthorized = err instanceof ServiceError && err.status === 403;
    return down(
      "qbittorrent",
      "qBittorrent",
      role,
      link,
      unauthorized && !user && !pass
        ? new ServiceError("needs a login — set QBITTORRENT_USER / QBITTORRENT_PASS")
        : err,
    );
  }
}
