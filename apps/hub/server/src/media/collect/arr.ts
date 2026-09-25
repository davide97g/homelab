import { config } from "../../config.js";
import { bytes, compact } from "../../format.js";
import { getJson, soft } from "../../http.js";
import type { MediaActivity, MediaStat } from "../../wire.js";
import { cap, clamp01, Collected, down, healthValue, unconfigured } from "./shape.js";

// Radarr, Sonarr and Prowlarr. Ported from mediarr-dash, which had these right;
// what changed is the shape they return (see shape.ts) and the formatting, which
// now goes through the hub's own format.ts so a gibibyte is a gibibyte on every
// page.

type HealthItem = { source?: string; type?: string; message?: string };
type SystemStatus = { version?: string };

type QueueRecord = {
  id?: number;
  title?: string;
  size?: number;
  sizeleft?: number;
  status?: string;
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
  errorMessage?: string;
  indexer?: string;
  movie?: { title?: string };
  series?: { title?: string };
  episode?: { seasonNumber?: number; episodeNumber?: number; title?: string };
};
type Queue = { totalRecords?: number; records?: QueueRecord[] };
type Paged = { totalRecords?: number };

function api<T>(base: string, key: string, path: string, version: "v1" | "v3"): Promise<T> {
  return getJson<T>(`${base}/api/${version}${path}`, { headers: { "x-api-key": key } });
}

function tally(items: HealthItem[] | null) {
  const errors = items?.filter((h) => h.type?.toLowerCase() === "error") ?? [];
  const warnings = items?.filter((h) => h.type?.toLowerCase() === "warning") ?? [];
  return { errors, warnings };
}

function queueActivity(records: QueueRecord[], kind: "movie" | "series"): MediaActivity[] {
  return cap(
    records.map((r, i) => {
      const size = r.size ?? 0;
      const left = r.sizeleft ?? 0;
      const doneFraction = size > 0 ? clamp01((size - left) / size) : undefined;
      const title = (kind === "movie" ? r.movie?.title : r.series?.title) ?? r.title ?? "unknown";
      const ep = r.episode;
      const subtitle =
        kind === "series" && ep?.seasonNumber != null
          ? `S${String(ep.seasonNumber).padStart(2, "0")}E${String(ep.episodeNumber ?? 0).padStart(2, "0")} ${ep.title ?? ""}`.trim()
          : r.indexer;
      // trackedDownloadStatus is the *arr's own verdict on an import it is
      // watching, and it is the only place a stuck import says so. A failed one
      // sits in the queue at 100% forever otherwise.
      const failed = (r.trackedDownloadStatus ?? "").toLowerCase() === "error" || Boolean(r.errorMessage);
      const row: MediaActivity = {
        id: String(r.id ?? i),
        title,
        state: r.trackedDownloadState ?? r.status,
        tone: failed ? "bad" : doneFraction === 1 ? "good" : "accent",
      };
      if (subtitle) row.subtitle = subtitle;
      if (doneFraction !== undefined) row.fraction = doneFraction;
      if (size) row.meta = bytes(size);
      return row;
    }),
  );
}

export type ArrKind = "radarr" | "sonarr";

type Movie = { hasFile?: boolean; sizeOnDisk?: number };
type Series = { statistics?: { episodeFileCount?: number; episodeCount?: number; sizeOnDisk?: number } };

/** The library listing is the only expensive call here — neither app has a count
 *  endpoint, so the whole collection comes back. The caller caches it far longer
 *  than the rest of the payload: a library does not change between two polls. */
export async function radarrLibrary(): Promise<MediaStat[]> {
  const { url, key } = config.radarr;
  const movies = await api<Movie[]>(url, key, "/movie", "v3");
  const onDisk = movies.filter((m) => m.hasFile).length;
  const size = movies.reduce((a, m) => a + (m.sizeOnDisk ?? 0), 0);
  return [
    {
      id: "library",
      label: "Movies",
      value: String(movies.length),
      hint: `${onDisk} on disk`,
      fraction: movies.length ? onDisk / movies.length : 0,
    },
    { id: "size", label: "Library size", value: bytes(size) },
  ];
}

export async function sonarrLibrary(): Promise<MediaStat[]> {
  const { url, key } = config.sonarr;
  const series = await api<Series[]>(url, key, "/series", "v3");
  let files = 0;
  let episodes = 0;
  let size = 0;
  for (const s of series) {
    files += s.statistics?.episodeFileCount ?? 0;
    episodes += s.statistics?.episodeCount ?? 0;
    size += s.statistics?.sizeOnDisk ?? 0;
  }
  return [
    {
      id: "library",
      label: "Series",
      value: String(series.length),
      hint: `${compact(files)}/${compact(episodes)} episodes`,
      fraction: episodes ? files / episodes : 0,
    },
    { id: "size", label: "Library size", value: bytes(size) },
  ];
}

/** Radarr and Sonarr answer the same API on different nouns, so one collector
 *  covers both and only the library query differs. */
export async function collectArr(kind: ArrKind, library: () => Promise<MediaStat[]>): Promise<Collected> {
  const label = kind === "radarr" ? "Radarr" : "Sonarr";
  const role = kind === "radarr" ? "Movies — decides and files" : "Series — decides and files";
  const link = kind === "radarr" ? config.links.radarr : config.links.sonarr;
  const { url, key } = kind === "radarr" ? config.radarr : config.sonarr;
  if (!key) return unconfigured(kind, label, role, link, `${label.toUpperCase()}_API_KEY`);

  const started = Date.now();
  try {
    const status = await api<SystemStatus>(url, key, "/system/status", "v3");
    const [health, queue, missing, libStats] = await Promise.all([
      soft(api<HealthItem[]>(url, key, "/health", "v3")),
      soft(
        api<Queue>(
          url,
          key,
          "/queue?pageSize=25&includeMovie=true&includeSeries=true&includeEpisode=true",
          "v3",
        ),
      ),
      soft(api<Paged>(url, key, "/wanted/missing?pageSize=1", "v3")),
      soft(library()),
    ]);

    const { errors, warnings } = tally(health);
    const records = queue?.records ?? [];
    const queued = queue?.totalRecords ?? records.length;
    const downloading = records.filter((r) => (r.status ?? "").toLowerCase() === "downloading").length;
    const missingCount = missing?.totalRecords ?? 0;
    const health1 = healthValue(errors.length, warnings.length);

    const stats: MediaStat[] = [
      ...(libStats ?? []),
      {
        id: "queue",
        label: "Queue",
        value: String(queued),
        ...(downloading ? { hint: `${downloading} downloading` } : {}),
        tone: queued > 0 ? "accent" : "default",
      },
      {
        id: "missing",
        label: "Missing",
        value: compact(missingCount),
        tone: missingCount > 0 ? "warn" : "good",
      },
      {
        id: "health",
        label: "Health",
        value: health1.value,
        tone: health1.tone,
        ...(errors[0]?.message ?? warnings[0]?.message
          ? { hint: (errors[0]?.message ?? warnings[0]?.message)! }
          : {}),
      },
    ];

    return {
      node: {
        id: kind,
        label,
        role,
        link,
        // An error the app reports about itself is a degraded node, not a dead
        // one: it is answering, and what it is saying is worth reading.
        status: errors.length ? "warn" : "up",
        ...(status?.version ? { version: status.version } : {}),
        latencyMs: Date.now() - started,
        stats,
        flags: [],
        activity: queueActivity(records, kind === "radarr" ? "movie" : "series"),
        activityLabel: "Queue",
      },
      flow: { queue: queued, downloading, missing: missingCount },
    };
  } catch (err) {
    return down(kind, label, role, link, err);
  }
}

type Indexer = { id?: number; name?: string; enable?: boolean };
type IndexerStats = {
  indexers?: {
    indexerId?: number;
    indexerName?: string;
    numberOfQueries?: number;
    numberOfGrabs?: number;
    numberOfFailedQueries?: number;
  }[];
};

export async function collectProwlarr(): Promise<Collected> {
  const role = "Indexers — searches";
  const link = config.links.prowlarr;
  const { url, key } = config.prowlarr;
  if (!key) return unconfigured("prowlarr", "Prowlarr", role, link, "PROWLARR_API_KEY");

  const started = Date.now();
  try {
    const status = await api<SystemStatus>(url, key, "/system/status", "v1");
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const until = new Date().toISOString();
    const [health, indexers, stats] = await Promise.all([
      soft(api<HealthItem[]>(url, key, "/health", "v1")),
      soft(api<Indexer[]>(url, key, "/indexer", "v1")),
      soft(api<IndexerStats>(url, key, `/indexerstats?startDate=${since}&endDate=${until}`, "v1")),
    ]);

    const { errors, warnings } = tally(health);
    const enabled = indexers?.filter((i) => i.enable).length ?? 0;
    const rows = stats?.indexers ?? [];
    const queries = rows.reduce((a, r) => a + (r.numberOfQueries ?? 0), 0);
    const grabs = rows.reduce((a, r) => a + (r.numberOfGrabs ?? 0), 0);
    const failed = rows.reduce((a, r) => a + (r.numberOfFailedQueries ?? 0), 0);
    const health1 = healthValue(errors.length, warnings.length);

    return {
      node: {
        id: "prowlarr",
        label: "Prowlarr",
        role,
        link,
        status: errors.length ? "warn" : "up",
        ...(status?.version ? { version: status.version } : {}),
        latencyMs: Date.now() - started,
        stats: [
          {
            id: "indexers",
            label: "Indexers",
            value: `${enabled}/${indexers?.length ?? 0}`,
            hint: "enabled",
            fraction: indexers?.length ? enabled / indexers.length : 0,
          },
          {
            id: "queries",
            label: "Queries 24h",
            value: compact(queries),
            ...(failed ? { hint: `${failed} failed` } : {}),
            tone: failed ? "warn" : "default",
          },
          { id: "grabs", label: "Grabs 24h", value: compact(grabs), tone: grabs > 0 ? "accent" : "default" },
          {
            id: "health",
            label: "Health",
            value: health1.value,
            tone: health1.tone,
            ...(errors[0]?.message ?? warnings[0]?.message
              ? { hint: (errors[0]?.message ?? warnings[0]?.message)! }
              : {}),
          },
        ],
        flags: [],
        activity: cap(
          rows
            .slice()
            .sort((a, b) => (b.numberOfQueries ?? 0) - (a.numberOfQueries ?? 0))
            .map((r, i) => {
              const row: MediaActivity = {
                id: String(r.indexerId ?? i),
                title: r.indexerName ?? "indexer",
                subtitle: `${compact(r.numberOfQueries ?? 0)} queries · ${compact(r.numberOfGrabs ?? 0)} grabs`,
                tone: (r.numberOfFailedQueries ?? 0) > 0 ? "warn" : "default",
              };
              if ((r.numberOfFailedQueries ?? 0) > 0) row.state = `${r.numberOfFailedQueries} failed`;
              return row;
            }),
        ),
        activityLabel: "Indexers, last 24h",
      },
      flow: { queries, grabs, failed },
    };
  } catch (err) {
    return down("prowlarr", "Prowlarr", role, link, err);
  }
}
