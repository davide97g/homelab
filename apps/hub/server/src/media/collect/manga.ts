import { config } from "../../config.js";
import { display } from "../../format.js";
import { getJson, request, soft } from "../../http.js";
import type { MediaActivity } from "../../wire.js";
import { cap, clamp01, Collected, down, unconfigured } from "./shape.js";

// The manga lane: Suwayomi downloads chapters as CBZ files, Kavita indexes the
// same folder, and Yomu is the reader people open. Its own compose project in
// ~/manga on the box (apps/manga in this repo), not part of mediarr.
//
// Only Yomu is public. Suwayomi has no auth at all and Kavita's admin UI stays on
// the LAN, which is why their links are box addresses and Yomu's is the tunnel.

// ——— Suwayomi ————————————————————————————————————————————————————————————————

type SuwayomiData = {
  aboutServer?: { version?: string };
  downloadStatus?: {
    state?: string;
    queue?: { state?: string; progress?: number; tries?: number; chapter?: { name?: string; manga?: { title?: string } } }[];
  };
  library?: {
    totalCount?: number;
    nodes?: { title?: string; downloadCount?: number; chapters?: { totalCount?: number }; source?: { displayName?: string } }[];
  };
  downloaded?: { totalCount?: number };
  extensions?: { totalCount?: number };
};

/** One query for the whole card. Suwayomi's GraphQL has no auth, so there is no
 *  key to collect; the port being LAN-only is the whole of its protection. */
const SUWAYOMI_QUERY = `{
  aboutServer { version }
  downloadStatus { state queue { state progress tries chapter { name manga { title } } } }
  library: mangas(condition: { inLibrary: true }) {
    totalCount
    nodes { title downloadCount chapters { totalCount } source { displayName } }
  }
  downloaded: chapters(condition: { isDownloaded: true }) { totalCount }
  extensions(condition: { isInstalled: true }) { totalCount }
}`;

export async function collectSuwayomi(): Promise<Collected> {
  const role = "Manga — finds and downloads chapters";
  const link = config.links.suwayomi;
  const started = Date.now();
  try {
    const res = await getJson<{ data?: SuwayomiData; errors?: { message?: string }[] }>(`${config.suwayomi.url}/api/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: SUWAYOMI_QUERY }),
    });
    if (!res?.data) throw new Error(res?.errors?.[0]?.message ?? "empty GraphQL answer");
    const d = res.data;

    const queue = d.downloadStatus?.queue ?? [];
    const running = d.downloadStatus?.state === "STARTED";
    // A chapter that has used up its retries sits in the queue as ERROR forever;
    // it is the one thing on this card worth a warn.
    const failed = queue.filter((q) => q.state === "ERROR").length;
    const series = d.library?.nodes ?? [];

    const activity: MediaActivity[] = cap([
      ...queue.map(
        (q, i): MediaActivity => ({
          id: `queue:${i}`,
          title: q.chapter?.manga?.title ?? "chapter",
          subtitle: q.chapter?.name ?? "",
          state: (q.state ?? "queued").toLowerCase(),
          tone: q.state === "ERROR" ? "bad" : q.state === "DOWNLOADING" ? "accent" : undefined,
          ...(typeof q.progress === "number" ? { fraction: clamp01(q.progress) } : {}),
          ...(q.tries ? { meta: `try ${q.tries}` } : {}),
        }),
      ),
      // Nothing queued: the library itself, as downloaded out of what the source
      // lists. Suwayomi keeps no download timestamp to sort a history by.
      ...(queue.length === 0
        ? series.map((s, i): MediaActivity => {
            const total = s.chapters?.totalCount ?? 0;
            const have = s.downloadCount ?? 0;
            return {
              id: `series:${i}`,
              title: s.title ?? "series",
              subtitle: `${have} of ${total} chapters · ${s.source?.displayName ?? ""}`.replace(/ · $/, ""),
              ...(total > 0 ? { fraction: clamp01(have / total) } : {}),
            };
          })
        : []),
    ]);

    return {
      node: {
        id: "suwayomi",
        label: "Suwayomi",
        role,
        link,
        status: failed > 0 ? "warn" : "up",
        ...(d.aboutServer?.version ? { version: d.aboutServer.version.replace(/^v/, "") } : {}),
        latencyMs: Date.now() - started,
        stats: [
          {
            id: "queue",
            label: "Queue",
            value: String(queue.length),
            ...(failed ? { hint: `${failed} failed` } : {}),
            tone: failed ? "bad" : queue.length ? "accent" : "good",
          },
          { id: "downloaded", label: "Chapters on disk", value: String(d.downloaded?.totalCount ?? 0) },
          { id: "library", label: "In library", value: String(d.library?.totalCount ?? 0), hint: "series that auto-download" },
        ],
        flags: [
          { label: "Downloader running", on: running },
          { label: `${d.extensions?.totalCount ?? 0} extensions`, on: (d.extensions?.totalCount ?? 0) > 0 },
        ],
        activity,
        activityLabel: queue.length ? "Downloads" : "Library",
      },
      flow: { queue: queue.length, running: running ? 1 : 0, failed },
    };
  } catch (err) {
    return down("suwayomi", "Suwayomi", role, link, err);
  }
}

// ——— Kavita ——————————————————————————————————————————————————————————————————

type KavitaInfo = { kavitaVersion?: string };
type KavitaStats = { seriesCount?: number; chapterCount?: number; totalFiles?: number; totalSize?: number };
/** Only the one field is read. The same payload carries the SMTP and OIDC
 *  config, which is why it is never passed on whole. */
type KavitaSettings = { enableFolderWatching?: boolean };
type KavitaLibrary = { name?: string; folderWatching?: boolean; lastScanned?: string };
type KavitaRecent = { seriesName?: string; created?: string; count?: number };

export async function collectKavita(): Promise<Collected> {
  const role = "Manga — library, users, progress";
  const link = config.links.kavita;
  const { url, key } = config.kavita;
  if (!key) return unconfigured("kavita", "Kavita", role, link, "KAVITA_API_KEY");

  // Kavita 0.9 takes an auth key straight in x-api-key, so there is no JWT to
  // mint and refresh. The key is the admin account's own "opds" key — stats and
  // server info are admin-only — which is also why it never leaves this process.
  const headers = { "x-api-key": key };
  const started = Date.now();
  try {
    // /api/health is anonymous and says nothing about the key; the stats call
    // is the one that proves both the server and the key.
    const stats = await getJson<KavitaStats>(`${url}/api/stats/server/stats`, { headers });
    const latencyMs = Date.now() - started;
    const [info, settings, libraries, recent] = await Promise.all([
      soft(getJson<KavitaInfo>(`${url}/api/server/server-info-slim`, { headers })),
      soft(getJson<KavitaSettings>(`${url}/api/settings`, { headers })),
      soft(getJson<KavitaLibrary[]>(`${url}/api/library/libraries`, { headers })),
      soft(getJson<KavitaRecent[]>(`${url}/api/series/recently-updated-series`, { headers, method: "POST" })),
    ]);

    // Folder watching is what makes a Suwayomi download appear here by itself.
    // It has a server-wide switch as well as the per-library one, the library
    // flag alone does nothing, and the server one ships off -- it was off here
    // until 2026-09-23. Either off means someone has to press Scan.
    const watching =
      settings?.enableFolderWatching === true &&
      (libraries ?? []).length > 0 &&
      (libraries ?? []).every((l) => l.folderWatching);
    const lastScanned = (libraries ?? [])
      .map((l) => l.lastScanned)
      .filter((s): s is string => Boolean(s))
      .sort()
      .at(-1);

    const activity: MediaActivity[] = cap(
      (recent ?? []).map(
        (r, i): MediaActivity => ({
          id: `recent:${i}`,
          title: r.seriesName ?? "series",
          subtitle: `${r.count ?? 0} new chapter${r.count === 1 ? "" : "s"}`,
          ...(r.created ? { meta: r.created.slice(0, 16).replace("T", " ") } : {}),
        }),
      ),
    );

    return {
      node: {
        id: "kavita",
        label: "Kavita",
        role,
        link,
        status: watching ? "up" : "warn",
        ...(info?.kavitaVersion ? { version: info.kavitaVersion } : {}),
        latencyMs,
        stats: [
          { id: "series", label: "Series", value: String(stats?.seriesCount ?? 0) },
          { id: "chapters", label: "Chapters", value: String(stats?.chapterCount ?? 0), hint: `${stats?.totalFiles ?? 0} files` },
          { id: "size", label: "On disk", value: display(stats?.totalSize ?? null, "bytes") },
          ...(lastScanned ? [{ id: "scanned", label: "Last scan", value: lastScanned.slice(0, 16).replace("T", " ") }] : []),
        ],
        flags: [{ label: "Folder watching", on: watching }],
        activity,
        activityLabel: "Recently added",
      },
      flow: { chapters: stats?.chapterCount ?? 0 },
    };
  } catch (err) {
    return down("kavita", "Kavita", role, link, err);
  }
}

// ——— Yomu ————————————————————————————————————————————————————————————————————

/** Yomu is asked through its public hostname, like Jellyfin through Cinema's:
 *  an answer proves the tunnel, the nginx and its /api proxy to Kavita, which
 *  is the path a reader takes. Both calls are anonymous. */
export async function collectYomu(): Promise<Collected> {
  const role = "Manga — the reader, public";
  const link = config.yomu.url;
  const started = Date.now();
  try {
    const page = await request(`${link}/`, { headers: { accept: "text/html" } });
    const latencyMs = Date.now() - started;
    const html = await page.text();
    // Yomu forwards /api/health to nobody -- it is not on the reader's
    // allowlist -- so the proxy is proven by a reader route answering 401
    // without a session, rather than by a 404 from nginx itself.
    const api = await soft(
      request(`${link}/api/series/on-deck`, { method: "POST", allowStatus: [401, 403, 404, 502, 503, 504] }).then(
        (r) => r.status,
      ),
    );
    const proxied = api === 401;
    const served = html.includes("<title>Yomu</title>");

    return {
      node: {
        id: "yomu",
        label: "Yomu",
        role,
        link,
        status: served && proxied ? "up" : "warn",
        latencyMs,
        stats: [
          { id: "page", label: "Page", value: served ? "served" : "not Yomu", tone: served ? "good" : "bad" },
          {
            id: "proxy",
            label: "Kavita through /api",
            value: proxied ? "answering" : api === null ? "no answer" : `HTTP ${api}`,
            tone: proxied ? "good" : "bad",
          },
          { id: "host", label: "Public at", value: new URL(link).host },
        ],
        flags: [],
        activity: [],
        activityLabel: "Activity",
      },
      flow: { up: served && proxied ? 1 : 0 },
    };
  } catch (err) {
    return down("yomu", "Yomu", role, link, err);
  }
}
