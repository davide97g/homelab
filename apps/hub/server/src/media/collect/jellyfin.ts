import { config } from "../../config.js";
import { compact, duration } from "../../format.js";
import { getJson, soft } from "../../http.js";
import type { MediaActivity, MediaStat } from "../../wire.js";
import { cap, clamp01, Collected, down, unconfigured } from "./shape.js";

type Info = { Version?: string; ServerName?: string };
type Counts = { MovieCount?: number; SeriesCount?: number; EpisodeCount?: number };
type Session = {
  Id: string;
  UserName?: string;
  Client?: string;
  DeviceName?: string;
  NowPlayingItem?: { Name?: string; SeriesName?: string; RunTimeTicks?: number; Type?: string };
  PlayState?: { PositionTicks?: number; IsPaused?: boolean; PlayMethod?: string };
  TranscodingInfo?: { TranscodeReasons?: string[] };
};
type Task = { Name?: string; State?: string; CurrentProgressPercentage?: number };

const TICKS_PER_SECOND = 10_000_000;

/** The NAS runs Jellyfin 12.1, which dropped the Emby-era header names: both
 *  `X-Emby-Token` and `X-MediaBrowser-Token` answer 401 to a valid key. This is
 *  the only form it still accepts, and it is the difference between this node
 *  working and this node reading as down with a perfectly good key.
 *
 *  mediarr-dash still sends `X-Emby-Token` here, which is why its Jellyfin card
 *  has been showing an error since the NAS upgrade. */
const headers = () => ({ authorization: `MediaBrowser Token="${config.jellyfin.key}"` });

export async function collectJellyfin(): Promise<Collected> {
  const role = "Library — scans and plays";
  // cinema.davideghiotto.it, not the box's :8096. The server is on the NAS; the
  // port on the mini PC is jellyfin-proxy, an nginx that exists only so
  // Jellyseerr can speak to a v12 server at all.
  const link = config.links.cinema;
  if (!config.jellyfin.key) return unconfigured("jellyfin", "Jellyfin", role, link, "JELLYFIN_API_KEY");

  const started = Date.now();
  const base = config.jellyfin.url;
  try {
    const info = await getJson<Info>(`${base}/System/Info`, { headers: headers() });
    const [counts, sessions, tasks] = await Promise.all([
      soft(getJson<Counts>(`${base}/Items/Counts`, { headers: headers() })),
      soft(getJson<Session[]>(`${base}/Sessions?activeWithinSeconds=300`, { headers: headers() })),
      soft(getJson<Task[]>(`${base}/ScheduledTasks`, { headers: headers() })),
    ]);

    const playing = (sessions ?? []).filter((s) => s.NowPlayingItem);
    // A transcode is the expensive case — the client could not play the file as
    // it is — so it is counted apart from plain playback. It is also the number
    // that explains a warm NAS.
    const transcoding = playing.filter((s) =>
      (s.PlayState?.PlayMethod ?? "").toLowerCase().includes("transcode"),
    );
    const runningTasks = (tasks ?? []).filter((t) => (t.State ?? "").toLowerCase() === "running");

    const activity: MediaActivity[] = cap(
      playing.map((s): MediaActivity => {
        const item = s.NowPlayingItem!;
        const total = (item.RunTimeTicks ?? 0) / TICKS_PER_SECOND;
        const position = (s.PlayState?.PositionTicks ?? 0) / TICKS_PER_SECOND;
        const method = s.PlayState?.PlayMethod ?? "";
        const row: MediaActivity = {
          id: s.Id,
          title: item.SeriesName ? `${item.SeriesName} — ${item.Name}` : (item.Name ?? "unknown"),
          subtitle: [s.UserName, s.DeviceName ?? s.Client].filter(Boolean).join(" · "),
          state: s.PlayState?.IsPaused ? "paused" : method || "playing",
          tone: method.toLowerCase().includes("transcode") ? "warn" : "good",
        };
        if (total > 0) {
          row.fraction = clamp01(position / total);
          row.meta = `${duration(position)} of ${duration(total)}`;
        }
        const reasons = s.TranscodingInfo?.TranscodeReasons;
        if (reasons?.length) row.meta = reasons.join(", ");
        return row;
      }),
    );

    const stats: MediaStat[] = [
      {
        id: "playing",
        label: "Now playing",
        value: String(playing.length),
        hint: transcoding.length ? `${transcoding.length} transcoding` : "all direct",
        tone: transcoding.length ? "warn" : playing.length ? "good" : "default",
      },
      { id: "movies", label: "Movies", value: compact(counts?.MovieCount ?? 0) },
      {
        id: "episodes",
        label: "Episodes",
        value: compact(counts?.EpisodeCount ?? 0),
        hint: `${counts?.SeriesCount ?? 0} series`,
      },
      { id: "sessions", label: "Sessions", value: String((sessions ?? []).length), hint: "last 5 min" },
    ];

    return {
      node: {
        id: "jellyfin",
        label: "Jellyfin",
        role,
        link,
        status: "up",
        ...(info?.Version ? { version: info.Version } : {}),
        latencyMs: Date.now() - started,
        stats,
        flags: runningTasks.slice(0, 2).map((t) => ({
          label: `${t.Name ?? "task"} ${Math.round(t.CurrentProgressPercentage ?? 0)}%`,
          on: true,
        })),
        activity,
        activityLabel: "Sessions",
      },
      flow: { playing: playing.length, transcoding: transcoding.length },
    };
  } catch (err) {
    return down("jellyfin", "Jellyfin", role, link, err);
  }
}
