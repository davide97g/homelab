import { config } from "../config.js";
import { request, ServiceError } from "../http.js";

// The two write targets in the media pipeline. Read-only views of it stay on
// mediarr-dash, which already does that well; what is here is only what the hub
// needs to be able to *change*.

type Arr = "radarr" | "sonarr";

function arrConfig(app: Arr): { url: string; key: string } {
  return app === "radarr" ? config.radarr : config.sonarr;
}

export function arrConfigured(app: Arr): boolean {
  return Boolean(arrConfig(app).key);
}

/** Queue a command. These are not idempotent upstream: a second call queues a
 *  second search, and Radarr will happily run both. That is the reason the
 *  dispatcher's idempotency key exists at all. */
export async function arrCommand(app: Arr, name: string): Promise<string> {
  const { url, key } = arrConfig(app);
  if (!key) throw new ServiceError(`${app}'s API key has not been collected on the box`);

  const res = await request(`${url}/api/v3/command`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ name }),
    timeoutMs: 20_000,
  });
  const body = (await res.json().catch(() => null)) as { id?: number } | null;
  return body?.id ? `${app} queued command ${name} (id ${body.id})` : `${app} accepted ${name}`;
}

/** qBittorrent's Web API, with the login quirk that cost an afternoon once
 *  already: 5.2.3 answers a *successful* login with 204, not 200. An exporter
 *  that insists on 200 logs "authentication failed" forever against correct
 *  credentials -- see the monitoring README. */
async function qbitSession(): Promise<string> {
  const { url, user, pass } = config.qbittorrent;
  if (!user && !pass) throw new ServiceError("qBittorrent's login has not been collected on the box");

  const res = await request(`${url}/api/v2/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", referer: url },
    body: new URLSearchParams({ username: user, password: pass }).toString(),
    timeoutMs: 15_000,
  });

  // getSetCookie, not get: a response may carry several Set-Cookie headers and
  // `get` folds them into one comma-joined string that a cookie value is allowed
  // to contain commas of.
  const raw = res.headers.getSetCookie?.() ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);

  // Whatever it set, sent back verbatim -- the name is not ours to predict.
  // qBittorrent 4.x called the session cookie `SID`; 5.x calls it
  // `QBT_SID_<port>`, so on this box it is `QBT_SID_8080`. Matching on `SID=`
  // finds neither of those reliably (`QBT_SID_8080=` does not contain `SID=`),
  // which made a perfectly good 204 login look like a refusal. Forwarding the
  // jar keeps this working across that rename and the next one.
  const jar = raw
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");

  if (!jar) {
    // Note that the status code is not the tell here: 5.2.3 answers a
    // *successful* login with 204, and a wrong password with 401 -- but an
    // older build answers a wrong password with 200 and the body "Fails.".
    // The cookie is the only reliable signal, which is the same trap that has
    // ghcr.io/martabal/qbittorrent-exporter logging "authentication failed"
    // forever against correct credentials.
    throw new ServiceError("qBittorrent accepted the login but set no session cookie");
  }
  return jar;
}

export function qbitConfigured(): boolean {
  return Boolean(config.qbittorrent.user || config.qbittorrent.pass);
}

/** Stop or start every torrent.
 *
 *  `stop` and `start` rather than `pause` and `resume`: qBittorrent 5.0 renamed
 *  the endpoints and the old names are deprecated aliases that a later release
 *  is free to drop. The box runs 5.2.3. */
export async function qbitAll(command: "stop" | "start"): Promise<string> {
  const cookie = await qbitSession();
  await request(`${config.qbittorrent.url}/api/v2/torrents/${command}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", referer: config.qbittorrent.url },
    body: new URLSearchParams({ hashes: "all" }).toString(),
    cookie,
    timeoutMs: 20_000,
  });
  return command === "stop" ? "every torrent stopped" : "every torrent started";
}

/** Dokploy's redeploy.
 *
 *  Dokploy has no scoped tokens: this key can delete every service on the box.
 *  So the compose ids it may be pointed at are an allow-list in the environment
 *  rather than anything the browser can choose, and the key itself never leaves
 *  this process. */
export async function dokployDeploy(composeId: string): Promise<string> {
  if (!config.dokployKey || !config.dokployUrl) throw new ServiceError("Dokploy is not configured");
  await request(`${config.dokployUrl}/api/compose.deploy`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.dokployKey },
    body: JSON.stringify({ composeId }),
    timeoutMs: 60_000,
  });
  return "deployment queued in Dokploy";
}
