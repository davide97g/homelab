import { config } from "../../config.js";
import { getJson, soft } from "../../http.js";
import type { MediaActivity } from "../../wire.js";
import { cap, Collected, down, unconfigured } from "./shape.js";

type SystemStatus = { data?: { bazarr_version?: string } };
// `providers` here is not the number configured — on a box with two throttled
// providers it read 0 — so nothing uses it. The throttled list below is the
// honest source for that, and it names them.
type Badges = {
  episodes?: number;
  movies?: number;
  sonarr_signalr?: string;
  radarr_signalr?: string;
};
type Providers = { data?: { name?: string; status?: string; retry?: string }[] };
type WantedMovies = { data?: { title?: string; missing_subtitles?: { name?: string; code2?: string }[] }[] };
type WantedEpisodes = {
  data?: {
    seriesTitle?: string;
    episode_number?: string;
    episodeTitle?: string;
    missing_subtitles?: { name?: string; code2?: string }[];
  }[];
};

/** Bazarr reports a healthy SignalR feed as "LIVE"; older builds said
 *  "connected". Either means the near-instant trigger on import is working, and
 *  a dead one is why subtitles would quietly stop appearing. */
function live(state?: string): boolean {
  const value = (state ?? "").toLowerCase();
  return value === "live" || value === "connected";
}

function langs(missing?: { name?: string; code2?: string }[]): string {
  return (missing ?? []).map((m) => m.code2 ?? m.name ?? "?").join(", ");
}

export async function collectBazarr(): Promise<Collected> {
  const role = "Subtitles — fetches .srt";
  const link = config.links.bazarr;
  const { url, key } = config.bazarr;
  if (!key) return unconfigured("bazarr", "Bazarr", role, link, "BAZARR_API_KEY");

  const started = Date.now();
  const headers = { "x-api-key": key };
  try {
    const status = await getJson<SystemStatus>(`${url}/api/system/status`, { headers });
    const [badges, providers, wantedMovies, wantedEpisodes] = await Promise.all([
      soft(getJson<Badges>(`${url}/api/badges`, { headers })),
      soft(getJson<Providers>(`${url}/api/providers`, { headers })),
      soft(getJson<WantedMovies>(`${url}/api/movies/wanted?start=0&length=12`, { headers })),
      soft(getJson<WantedEpisodes>(`${url}/api/episodes/wanted?start=0&length=12`, { headers })),
    ]);

    // `providers` lists only the ones currently throttled, so an empty list is
    // the healthy case. A throttled provider stays throttled for 12 hours after
    // the cause is fixed, which is why it is named rather than folded into a
    // health count.
    const throttled = providers?.data ?? [];
    const wantedMovieCount = badges?.movies ?? 0;
    const wantedEpisodeCount = badges?.episodes ?? 0;
    const wanted = wantedMovieCount + wantedEpisodeCount;

    const activity: MediaActivity[] = cap([
      ...(wantedMovies?.data ?? []).map(
        (m, i): MediaActivity => ({
          id: `movie:${i}`,
          title: m.title ?? "movie",
          subtitle: `missing ${langs(m.missing_subtitles)}`,
          state: "movie",
          tone: "warn",
        }),
      ),
      ...(wantedEpisodes?.data ?? []).map(
        (e, i): MediaActivity => ({
          id: `episode:${i}`,
          title: e.seriesTitle ?? "series",
          subtitle: `${e.episode_number ?? ""} ${e.episodeTitle ?? ""} — missing ${langs(e.missing_subtitles)}`.trim(),
          state: "episode",
          tone: "warn",
        }),
      ),
    ]);

    return {
      node: {
        id: "bazarr",
        label: "Bazarr",
        role,
        link,
        status: throttled.length ? "warn" : "up",
        ...(status?.data?.bazarr_version ? { version: status.data.bazarr_version } : {}),
        latencyMs: Date.now() - started,
        stats: [
          {
            id: "wanted",
            label: "Wanted",
            value: String(wanted),
            hint: `${wantedMovieCount} movies · ${wantedEpisodeCount} episodes`,
            tone: wanted > 0 ? "warn" : "good",
          },
          {
            id: "throttled",
            label: "Throttled providers",
            value: String(throttled.length),
            ...(throttled.length
              ? { hint: throttled.map((p) => p.name).filter(Boolean).join(", ") }
              : {}),
            tone: throttled.length ? "bad" : "good",
          },
        ],
        flags: [
          { label: "Radarr feed", on: live(badges?.radarr_signalr) },
          { label: "Sonarr feed", on: live(badges?.sonarr_signalr) },
        ],
        activity,
        activityLabel: "Missing subtitles",
      },
      flow: { wanted, throttled: throttled.length },
    };
  } catch (err) {
    return down("bazarr", "Bazarr", role, link, err);
  }
}
