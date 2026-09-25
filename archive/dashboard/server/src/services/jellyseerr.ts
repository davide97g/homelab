import { getJson, soft } from "../http.js";
import { Activity, Snapshot, Stat, down, unconfigured } from "./types.js";

type Status = { version?: string; updateAvailable?: boolean };
type Counts = {
  total?: number; movie?: number; tv?: number;
  pending?: number; approved?: number; declined?: number;
  processing?: number;
};
type Request = {
  id: number;
  status: number;
  createdAt?: string;
  type?: string;
  requestedBy?: { displayName?: string; username?: string };
  media?: { id?: number; mediaType?: "movie" | "tv"; tmdbId?: number; status?: number };
};
type RequestPage = { results?: Request[] };
type MediaPage = { pageInfo?: { results?: number } };
type Job = { id: string; name?: string; nextExecutionTime?: string; running?: boolean };

// MediaRequestStatus / MediaStatus in Jellyseerr are plain ints on the wire.
const REQUEST_STATE: Record<number, string> = { 1: "pending", 2: "approved", 3: "declined", 4: "failed" };
const MEDIA_STATE: Record<number, string> = { 1: "unknown", 2: "pending", 3: "processing", 4: "partial", 5: "available" };

/** A request carries a tmdbId but no title -- Jellyseerr's own UI resolves those
 *  against TMDB per item. We go through Jellyseerr's TMDB proxy so no second API
 *  key is needed, and keep the answers forever: a film's title does not change. */
const titles = new Map<string, string>();

async function titleFor(base: string, key: string, media: Request["media"]): Promise<string> {
  const type = media?.mediaType === "tv" ? "tv" : "movie";
  const id = media?.tmdbId;
  if (!id) return "unknown title";
  const cacheKey = `${type}:${id}`;
  const hit = titles.get(cacheKey);
  if (hit) return hit;
  try {
    const detail = await getJson<{ title?: string; name?: string; releaseDate?: string; firstAirDate?: string }>(
      `${base}/api/v1/${type}/${id}`,
      { headers: { "X-Api-Key": key } },
    );
    const year = (detail.releaseDate ?? detail.firstAirDate ?? "").slice(0, 4);
    const label = `${detail.title ?? detail.name ?? `#${id}`}${year ? ` (${year})` : ""}`;
    titles.set(cacheKey, label);
    return label;
  } catch {
    return `${type === "tv" ? "Series" : "Movie"} #${id}`;
  }
}

export async function collectJellyseerr(base: string, key: string, link: string): Promise<Snapshot> {
  const role = "Requests — the front door";
  if (!key) return unconfigured("jellyseerr", "Jellyseerr", role, link, "JELLYSEERR_API_KEY");

  const started = Date.now();
  const headers = { "X-Api-Key": key };
  try {
    const status = await getJson<Status>(`${base}/api/v1/status`, { headers });
    // `request/count` reports available as 0 here even with available media --
    // it counts requests, and a request stops being counted once its media is
    // done. The media index is the honest number, so availability comes from
    // there and only the request-side figures come from the counter.
    const [counts, page, jobs, mediaAll, mediaAvailable] = await Promise.all([
      soft(getJson<Counts>(`${base}/api/v1/request/count`, { headers })),
      soft(getJson<RequestPage>(`${base}/api/v1/request?take=8&skip=0&sort=added&filter=all`, { headers })),
      soft(getJson<Job[]>(`${base}/api/v1/settings/jobs`, { headers })),
      soft(getJson<MediaPage>(`${base}/api/v1/media?take=1&filter=all`, { headers })),
      soft(getJson<MediaPage>(`${base}/api/v1/media?take=1&filter=available`, { headers })),
    ]);

    const results = page?.results ?? [];
    const activity: Activity[] = await Promise.all(
      results.map(async (r) => {
        const mediaState = MEDIA_STATE[r.media?.status ?? 1] ?? "unknown";
        const reqState = REQUEST_STATE[r.status] ?? "unknown";
        const state = mediaState === "available" ? "available" : reqState === "approved" ? mediaState : reqState;
        return {
          id: String(r.id),
          title: await titleFor(base, key, r.media),
          subtitle: [r.media?.mediaType === "tv" ? "series" : "movie", r.requestedBy?.displayName ?? r.requestedBy?.username]
            .filter(Boolean)
            .join(" · "),
          state,
          tone: state === "available" ? "good" : state === "declined" || state === "failed" ? "bad" : state === "pending" ? "warn" : "accent",
          meta: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : undefined,
        } satisfies Activity;
      }),
    );

    const pending = counts?.pending ?? 0;
    const total = counts?.total ?? 0;
    const tracked = mediaAll?.pageInfo?.results ?? 0;
    const available = mediaAvailable?.pageInfo?.results ?? 0;

    const stats: Stat[] = [
      { label: "Requests", value: String(total), hint: `${counts?.movie ?? 0} movies · ${counts?.tv ?? 0} tv` },
      { label: "Pending", value: String(pending), tone: pending > 0 ? "warn" : "good" },
      { label: "Processing", value: String(counts?.processing ?? 0), tone: (counts?.processing ?? 0) > 0 ? "accent" : "default" },
      {
        label: "Available",
        value: String(available),
        hint: tracked ? `of ${tracked} tracked` : undefined,
        tone: "good",
        progress: tracked ? Math.min(1, available / tracked) : 0,
      },
    ];

    const nextJob = (jobs ?? [])
      .filter((j) => j.nextExecutionTime)
      .sort((a, b) => Date.parse(a.nextExecutionTime!) - Date.parse(b.nextExecutionTime!))[0];
    const running = (jobs ?? []).filter((j) => j.running).length;

    return {
      id: "jellyseerr",
      name: "Jellyseerr",
      role,
      link,
      status: "up",
      version: status?.version,
      latencyMs: Date.now() - started,
      stats,
      flags: [
        ...(status?.updateAvailable != null ? [{ label: "Update available", on: !!status.updateAvailable }] : []),
        ...(running ? [{ label: `${running} job running`, on: true }] : []),
        ...(nextJob?.name ? [{ label: `Next: ${nextJob.name}`, on: false }] : []),
      ],
      activityLabel: "Latest requests",
      activity,
    };
  } catch (err) {
    return down("jellyseerr", "Jellyseerr", role, link, err);
  }
}
