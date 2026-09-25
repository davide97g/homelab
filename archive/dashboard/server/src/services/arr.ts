import { getJson, soft } from "../http.js";
import { Activity, Snapshot, Stat, bytes, compact, down, unconfigured } from "./types.js";

type HealthItem = { source: string; type: string; message: string };
type SystemStatus = { version?: string; appName?: string };

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

function api(base: string, key: string, path: string, version: "v1" | "v3") {
  return getJson<unknown>(`${base}/api/${version}${path}`, { headers: { "X-Api-Key": key } });
}

/** Health entries are the *arr apps telling on themselves. An `error` is worth a
 *  red node; a `warning` (an indexer that failed once, an update available) is
 *  not, so the two are counted separately. */
function healthTally(items: HealthItem[] | null) {
  const errors = items?.filter((h) => h.type?.toLowerCase() === "error") ?? [];
  const warnings = items?.filter((h) => h.type?.toLowerCase() === "warning") ?? [];
  return { errors, warnings };
}

function queueActivity(records: QueueRecord[], kind: "movie" | "series"): Activity[] {
  return records.slice(0, 25).map((r, i) => {
    const size = r.size ?? 0;
    const left = r.sizeleft ?? 0;
    const done = size > 0 ? Math.min(1, Math.max(0, (size - left) / size)) : undefined;
    const title =
      kind === "movie"
        ? r.movie?.title ?? r.title ?? "unknown"
        : r.series?.title ?? r.title ?? "unknown";
    const ep = r.episode;
    const subtitle =
      kind === "series" && ep?.seasonNumber != null
        ? `S${String(ep.seasonNumber).padStart(2, "0")}E${String(ep.episodeNumber ?? 0).padStart(2, "0")}  ${ep.title ?? ""}`.trim()
        : r.indexer;
    const failed = (r.trackedDownloadStatus ?? "").toLowerCase() === "error" || !!r.errorMessage;
    return {
      id: String(r.id ?? i),
      title,
      subtitle,
      progress: done,
      state: r.trackedDownloadState ?? r.status,
      tone: failed ? "bad" : done === 1 ? "good" : "accent",
      meta: size ? bytes(size) : undefined,
    } satisfies Activity;
  });
}

export type ArrKind = "radarr" | "sonarr";

/** Radarr and Sonarr answer the same API on different nouns, so one collector
 *  covers both and only the library-count query differs. */
export async function collectArr(
  kind: ArrKind,
  base: string,
  key: string,
  link: string,
  library: () => Promise<Stat[]>,
): Promise<Snapshot> {
  const name = kind === "radarr" ? "Radarr" : "Sonarr";
  const role = kind === "radarr" ? "Movies — decides & files" : "Series — decides & files";
  if (!key) return unconfigured(kind, name, role, link, `${name.toUpperCase()}_API_KEY`);

  const started = Date.now();
  try {
    const status = (await api(base, key, "/system/status", "v3")) as SystemStatus;
    const [health, queue, missing, libStats] = await Promise.all([
      soft(api(base, key, "/health", "v3") as Promise<HealthItem[]>),
      soft(api(base, key, "/queue?pageSize=25&includeMovie=true&includeSeries=true&includeEpisode=true", "v3") as Promise<Queue>),
      soft(api(base, key, "/wanted/missing?pageSize=1", "v3") as Promise<Paged>),
      soft(library()),
    ]);

    const { errors, warnings } = healthTally(health);
    const records = queue?.records ?? [];
    const downloading = records.filter((r) => (r.status ?? "").toLowerCase() === "downloading").length;

    const stats: Stat[] = [
      ...(libStats ?? []),
      {
        label: "Queue",
        value: String(queue?.totalRecords ?? records.length),
        hint: downloading ? `${downloading} downloading` : undefined,
        tone: (queue?.totalRecords ?? 0) > 0 ? "accent" : "default",
      },
      {
        label: "Missing",
        value: compact(missing?.totalRecords ?? 0),
        tone: (missing?.totalRecords ?? 0) > 0 ? "warn" : "good",
      },
      {
        label: "Health",
        value: errors.length ? `${errors.length} error${errors.length > 1 ? "s" : ""}` : warnings.length ? `${warnings.length} warning${warnings.length > 1 ? "s" : ""}` : "clean",
        hint: errors[0]?.message ?? warnings[0]?.message,
        tone: errors.length ? "bad" : warnings.length ? "warn" : "good",
      },
    ];

    return {
      id: kind,
      name,
      role,
      link,
      status: errors.length ? "warn" : "up",
      version: status?.version,
      latencyMs: Date.now() - started,
      stats,
      activityLabel: "Queue",
      activity: queueActivity(records, kind === "radarr" ? "movie" : "series"),
    };
  } catch (err) {
    return down(kind, name, role, link, err);
  }
}

type Movie = { hasFile?: boolean; sizeOnDisk?: number; monitored?: boolean };

export async function radarrLibrary(base: string, key: string): Promise<Stat[]> {
  const movies = (await api(base, key, "/movie", "v3")) as Movie[];
  const onDisk = movies.filter((m) => m.hasFile).length;
  const size = movies.reduce((a, m) => a + (m.sizeOnDisk ?? 0), 0);
  return [
    { label: "Movies", value: String(movies.length), hint: `${onDisk} on disk`, progress: movies.length ? onDisk / movies.length : 0 },
    { label: "Library size", value: bytes(size) },
  ];
}

type Series = { statistics?: { episodeFileCount?: number; episodeCount?: number; sizeOnDisk?: number } };

export async function sonarrLibrary(base: string, key: string): Promise<Stat[]> {
  const series = (await api(base, key, "/series", "v3")) as Series[];
  let files = 0;
  let episodes = 0;
  let size = 0;
  for (const s of series) {
    files += s.statistics?.episodeFileCount ?? 0;
    episodes += s.statistics?.episodeCount ?? 0;
    size += s.statistics?.sizeOnDisk ?? 0;
  }
  return [
    { label: "Series", value: String(series.length), hint: `${compact(files)}/${compact(episodes)} episodes`, progress: episodes ? files / episodes : 0 },
    { label: "Library size", value: bytes(size) },
  ];
}

type Indexer = { id: number; name?: string; enable?: boolean; protocol?: string };
type IndexerStats = {
  indexers?: { indexerId?: number; indexerName?: string; numberOfQueries?: number; numberOfGrabs?: number; numberOfFailedQueries?: number; numberOfFailedGrabs?: number }[];
};

export async function collectProwlarr(base: string, key: string, link: string): Promise<Snapshot> {
  const role = "Indexers — searches";
  if (!key) return unconfigured("prowlarr", "Prowlarr", role, link, "PROWLARR_API_KEY");

  const started = Date.now();
  try {
    const status = (await api(base, key, "/system/status", "v1")) as SystemStatus;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const until = new Date().toISOString();
    const [health, indexers, stats] = await Promise.all([
      soft(api(base, key, "/health", "v1") as Promise<HealthItem[]>),
      soft(api(base, key, "/indexer", "v1") as Promise<Indexer[]>),
      soft(api(base, key, `/indexerstats?startDate=${since}&endDate=${until}`, "v1") as Promise<IndexerStats>),
    ]);

    const { errors, warnings } = healthTally(health);
    const enabled = indexers?.filter((i) => i.enable).length ?? 0;
    const rows = stats?.indexers ?? [];
    const queries = rows.reduce((a, r) => a + (r.numberOfQueries ?? 0), 0);
    const grabs = rows.reduce((a, r) => a + (r.numberOfGrabs ?? 0), 0);
    const failed = rows.reduce((a, r) => a + (r.numberOfFailedQueries ?? 0), 0);

    return {
      id: "prowlarr",
      name: "Prowlarr",
      role,
      link,
      status: errors.length ? "warn" : "up",
      version: status?.version,
      latencyMs: Date.now() - started,
      stats: [
        { label: "Indexers", value: `${enabled}/${indexers?.length ?? 0}`, hint: "enabled", progress: indexers?.length ? enabled / indexers.length : 0 },
        { label: "Queries 24h", value: compact(queries), hint: failed ? `${failed} failed` : undefined, tone: failed ? "warn" : "default" },
        { label: "Grabs 24h", value: compact(grabs), tone: grabs > 0 ? "accent" : "default" },
        {
          label: "Health",
          value: errors.length ? `${errors.length} error${errors.length > 1 ? "s" : ""}` : warnings.length ? `${warnings.length} warning${warnings.length > 1 ? "s" : ""}` : "clean",
          hint: errors[0]?.message ?? warnings[0]?.message,
          tone: errors.length ? "bad" : warnings.length ? "warn" : "good",
        },
      ],
      activityLabel: "Indexers, last 24h",
      activity: rows
        .slice()
        .sort((a, b) => (b.numberOfQueries ?? 0) - (a.numberOfQueries ?? 0))
        .slice(0, 25)
        .map((r, i) => ({
          id: String(r.indexerId ?? i),
          title: r.indexerName ?? "indexer",
          subtitle: `${compact(r.numberOfQueries ?? 0)} queries · ${compact(r.numberOfGrabs ?? 0)} grabs`,
          state: (r.numberOfFailedQueries ?? 0) > 0 ? `${r.numberOfFailedQueries} failed` : undefined,
          tone: (r.numberOfFailedQueries ?? 0) > 0 ? "warn" : "default",
        })),
    };
  } catch (err) {
    return down("prowlarr", "Prowlarr", role, link, err);
  }
}
