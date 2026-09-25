import { getJson, soft } from "../http.js";
import { Activity, Snapshot, down, unconfigured } from "./types.js";

type SystemStatus = { data?: { bazarr_version?: string; sonarr_version?: string; radarr_version?: string } };
type Badges = { episodes?: number; movies?: number; providers?: number; status?: number; sonarr_signalr?: string; radarr_signalr?: string };
type Providers = { data?: { name?: string; status?: string; retry?: string }[] };
type WantedMovies = { data?: { title?: string; missing_subtitles?: { name?: string; code2?: string }[] }[] };
type WantedEpisodes = { data?: { seriesTitle?: string; episode_number?: string; episodeTitle?: string; missing_subtitles?: { name?: string; code2?: string }[] }[] };

/** Bazarr reports a healthy SignalR feed as "LIVE"; older builds said
 *  "connected". Either means the near-instant trigger on import is working. */
function live(state?: string): boolean {
  const value = (state ?? "").toLowerCase();
  return value === "live" || value === "connected";
}

function langs(missing?: { name?: string; code2?: string }[]): string {
  return (missing ?? []).map((m) => m.code2 ?? m.name ?? "?").join(", ");
}

export async function collectBazarr(base: string, key: string, link: string): Promise<Snapshot> {
  const role = "Subtitles — fetches .srt";
  if (!key) return unconfigured("bazarr", "Bazarr", role, link, "BAZARR_API_KEY");

  const started = Date.now();
  const headers = { "X-API-KEY": key };
  try {
    const status = await getJson<SystemStatus>(`${base}/api/system/status`, { headers });
    const [badges, providers, wantedMovies, wantedEpisodes] = await Promise.all([
      soft(getJson<Badges>(`${base}/api/badges`, { headers })),
      soft(getJson<Providers>(`${base}/api/providers`, { headers })),
      soft(getJson<WantedMovies>(`${base}/api/movies/wanted?start=0&length=12`, { headers })),
      soft(getJson<WantedEpisodes>(`${base}/api/episodes/wanted?start=0&length=12`, { headers })),
    ]);

    // `providers` lists only the ones currently throttled; an empty list is the
    // healthy case. A throttled provider stays throttled for 12h after the cause
    // is fixed, so it is worth showing rather than folding into a health count.
    const throttled = providers?.data ?? [];
    const wantedMovieCount = badges?.movies ?? 0;
    const wantedEpisodeCount = badges?.episodes ?? 0;
    const wanted = wantedMovieCount + wantedEpisodeCount;

    const activity: Activity[] = [
      ...(wantedMovies?.data ?? []).map((m, i) => ({
        id: `m${i}`,
        title: m.title ?? "movie",
        subtitle: `missing ${langs(m.missing_subtitles)}`,
        state: "movie",
        tone: "warn" as const,
      })),
      ...(wantedEpisodes?.data ?? []).map((e, i) => ({
        id: `e${i}`,
        title: e.seriesTitle ?? "series",
        subtitle: `${e.episode_number ?? ""} ${e.episodeTitle ?? ""} — missing ${langs(e.missing_subtitles)}`.trim(),
        state: "episode",
        tone: "warn" as const,
      })),
    ];

    return {
      id: "bazarr",
      name: "Bazarr",
      role,
      link,
      status: throttled.length ? "warn" : "up",
      version: status?.data?.bazarr_version,
      latencyMs: Date.now() - started,
      stats: [
        { label: "Wanted", value: String(wanted), hint: `${wantedMovieCount} movies · ${wantedEpisodeCount} episodes`, tone: wanted > 0 ? "warn" : "good" },
        { label: "Throttled providers", value: String(throttled.length), hint: throttled.map((p) => p.name).filter(Boolean).join(", ") || undefined, tone: throttled.length ? "bad" : "good" },
      ],
      flags: [
        { label: "Radarr feed", on: live(badges?.radarr_signalr) },
        { label: "Sonarr feed", on: live(badges?.sonarr_signalr) },
      ],
      activityLabel: "Missing subtitles",
      activity,
    };
  } catch (err) {
    return down("bazarr", "Bazarr", role, link, err);
  }
}
