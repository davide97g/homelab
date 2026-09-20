import { config } from "../../config.js";
import { getJson, soft } from "../../http.js";
import type { MediaActivity, MediaStat } from "../../wire.js";
import { cap, clamp01, Collected, down, unconfigured } from "./shape.js";

type Status = { version?: string; updateAvailable?: boolean };
type Counts = {
  total?: number;
  movie?: number;
  tv?: number;
  pending?: number;
  approved?: number;
  declined?: number;
  processing?: number;
};
type RequestRow = {
  id: number;
  status: number;
  createdAt?: string;
  requestedBy?: { displayName?: string; username?: string };
  media?: { mediaType?: "movie" | "tv"; tmdbId?: number; status?: number };
};
type RequestPage = { results?: RequestRow[] };
type MediaPage = { pageInfo?: { results?: number } };
type Job = { id?: string; name?: string; nextExecutionTime?: string; running?: boolean };

// MediaRequestStatus and MediaStatus are plain ints on the wire.
const REQUEST_STATE: Record<number, string> = { 1: "pending", 2: "approved", 3: "declined", 4: "failed" };
const MEDIA_STATE: Record<number, string> = {
  1: "unknown",
  2: "pending",
  3: "processing",
  4: "partial",
  5: "available",
};

/** A request carries a tmdbId and no title — Jellyseerr's own UI resolves each
 *  one against TMDB. Going through Jellyseerr's TMDB proxy means no second API
 *  key, and the answers are kept for the life of the process: a film's title
 *  does not change. */
const titles = new Map<string, string>();

async function titleFor(base: string, key: string, media: RequestRow["media"]): Promise<string> {
  const type = media?.mediaType === "tv" ? "tv" : "movie";
  const id = media?.tmdbId;
  if (!id) return "unknown title";
  const cacheKey = `${type}:${id}`;
  const hit = titles.get(cacheKey);
  if (hit) return hit;
  try {
    const detail = await getJson<{
      title?: string;
      name?: string;
      releaseDate?: string;
      firstAirDate?: string;
    }>(`${base}/api/v1/${type}/${id}`, { headers: { "x-api-key": key } });
    const year = (detail.releaseDate ?? detail.firstAirDate ?? "").slice(0, 4);
    const label = `${detail.title ?? detail.name ?? `#${id}`}${year ? ` (${year})` : ""}`;
    titles.set(cacheKey, label);
    return label;
  } catch {
    return `${type === "tv" ? "Series" : "Movie"} #${id}`;
  }
}

export async function collectJellyseerr(): Promise<Collected> {
  const role = "Requests — the front door";
  const link = config.links.jellyseerr;
  const { url, key } = config.jellyseerr;
  if (!key) return unconfigured("jellyseerr", "Jellyseerr", role, link, "JELLYSEERR_API_KEY");

  const started = Date.now();
  const headers = { "x-api-key": key };
  try {
    const status = await getJson<Status>(`${url}/api/v1/status`, { headers });
    // `request/count` reports available as 0 even with available media: it
    // counts *requests*, and a request stops being counted once its media is
    // done. The media index is the honest number, so availability comes from
    // there and only the request-side figures come from the counter.
    const [counts, page, jobs, mediaAll, mediaAvailable] = await Promise.all([
      soft(getJson<Counts>(`${url}/api/v1/request/count`, { headers })),
      soft(getJson<RequestPage>(`${url}/api/v1/request?take=8&skip=0&sort=added&filter=all`, { headers })),
      soft(getJson<Job[]>(`${url}/api/v1/settings/jobs`, { headers })),
      soft(getJson<MediaPage>(`${url}/api/v1/media?take=1&filter=all`, { headers })),
      soft(getJson<MediaPage>(`${url}/api/v1/media?take=1&filter=available`, { headers })),
    ]);

    const rows = page?.results ?? [];
    const activity: MediaActivity[] = cap(
      await Promise.all(
        rows.map(async (r): Promise<MediaActivity> => {
          const mediaState = MEDIA_STATE[r.media?.status ?? 1] ?? "unknown";
          const requestState = REQUEST_STATE[r.status] ?? "unknown";
          // What it is *doing* beats what it was asked for: an approved request
          // whose media is still copying reads "processing", not "approved".
          const state =
            mediaState === "available" ? "available" : requestState === "approved" ? mediaState : requestState;
          const row: MediaActivity = {
            id: String(r.id),
            title: await titleFor(url, key, r.media),
            subtitle: [
              r.media?.mediaType === "tv" ? "series" : "movie",
              r.requestedBy?.displayName ?? r.requestedBy?.username,
            ]
              .filter(Boolean)
              .join(" · "),
            state,
            tone:
              state === "available"
                ? "good"
                : state === "declined" || state === "failed"
                  ? "bad"
                  : state === "pending"
                    ? "warn"
                    : "accent",
          };
          if (r.createdAt) row.meta = new Date(r.createdAt).toLocaleDateString("en-GB");
          return row;
        }),
      ),
    );

    const pending = counts?.pending ?? 0;
    const processing = counts?.processing ?? 0;
    const total = counts?.total ?? 0;
    const tracked = mediaAll?.pageInfo?.results ?? 0;
    const available = mediaAvailable?.pageInfo?.results ?? 0;

    const stats: MediaStat[] = [
      {
        id: "requests",
        label: "Requests",
        value: String(total),
        hint: `${counts?.movie ?? 0} movies · ${counts?.tv ?? 0} tv`,
      },
      { id: "pending", label: "Pending", value: String(pending), tone: pending > 0 ? "warn" : "good" },
      {
        id: "processing",
        label: "Processing",
        value: String(processing),
        tone: processing > 0 ? "accent" : "default",
      },
      {
        id: "available",
        label: "Available",
        value: String(available),
        ...(tracked ? { hint: `of ${tracked} tracked` } : {}),
        tone: "good",
        fraction: tracked ? clamp01(available / tracked) : 0,
      },
    ];

    const nextJob = (jobs ?? [])
      .filter((j) => j.nextExecutionTime)
      .sort((a, b) => Date.parse(a.nextExecutionTime!) - Date.parse(b.nextExecutionTime!))[0];
    const running = (jobs ?? []).filter((j) => j.running).length;

    return {
      node: {
        id: "jellyseerr",
        label: "Jellyseerr",
        role,
        link,
        status: "up",
        ...(status?.version ? { version: status.version } : {}),
        latencyMs: Date.now() - started,
        stats,
        flags: [
          ...(status?.updateAvailable != null
            ? [{ label: "Update available", on: Boolean(status.updateAvailable) }]
            : []),
          ...(running ? [{ label: `${running} job running`, on: true }] : []),
          ...(nextJob?.name ? [{ label: `Next: ${nextJob.name}`, on: false }] : []),
        ],
        activity,
        activityLabel: "Latest requests",
      },
      flow: { pending, processing, total, available },
    };
  } catch (err) {
    return down("jellyseerr", "Jellyseerr", role, link, err);
  }
}
