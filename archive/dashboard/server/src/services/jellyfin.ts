import { getJson, soft } from "../http.js";
import { Activity, Snapshot, Stat, compact, down, unconfigured } from "./types.js";

type Info = { Version?: string; ServerName?: string; Id?: string };
type Counts = { MovieCount?: number; SeriesCount?: number; EpisodeCount?: number; ItemCount?: number };
type Session = {
  Id: string;
  UserName?: string;
  Client?: string;
  DeviceName?: string;
  NowPlayingItem?: { Name?: string; SeriesName?: string; RunTimeTicks?: number; Type?: string; ProductionYear?: number };
  PlayState?: { PositionTicks?: number; IsPaused?: boolean; PlayMethod?: string };
  TranscodingInfo?: { IsVideoDirect?: boolean; Framerate?: number; CompletionPercentage?: number; TranscodeReasons?: string[] };
};
type Task = { Name?: string; State?: string; CurrentProgressPercentage?: number };

const TICKS_PER_SECOND = 10_000_000;

export async function collectJellyfin(base: string, key: string, link: string): Promise<Snapshot> {
  const role = "Library — scans & plays";
  if (!key) return unconfigured("jellyfin", "Jellyfin", role, link, "JELLYFIN_API_KEY");

  const started = Date.now();
  const headers = { "X-Emby-Token": key };
  try {
    const info = await getJson<Info>(`${base}/System/Info`, { headers });
    const [counts, sessions, tasks] = await Promise.all([
      soft(getJson<Counts>(`${base}/Items/Counts`, { headers })),
      soft(getJson<Session[]>(`${base}/Sessions?activeWithinSeconds=300`, { headers })),
      soft(getJson<Task[]>(`${base}/ScheduledTasks`, { headers })),
    ]);

    const playing = (sessions ?? []).filter((s) => s.NowPlayingItem);
    // A transcode is the expensive case: it means the client could not play the
    // file as-is, so it is worth calling out separately from plain playback.
    const transcoding = playing.filter((s) => (s.PlayState?.PlayMethod ?? "").toLowerCase().includes("transcode"));
    const runningTasks = (tasks ?? []).filter((t) => (t.State ?? "").toLowerCase() === "running");

    const activity: Activity[] = playing.map((s) => {
      const item = s.NowPlayingItem!;
      const total = (item.RunTimeTicks ?? 0) / TICKS_PER_SECOND;
      const pos = (s.PlayState?.PositionTicks ?? 0) / TICKS_PER_SECOND;
      const title = item.SeriesName ? `${item.SeriesName} — ${item.Name}` : item.Name ?? "unknown";
      const method = s.PlayState?.PlayMethod ?? "";
      return {
        id: s.Id,
        title,
        subtitle: [s.UserName, s.DeviceName ?? s.Client].filter(Boolean).join(" · "),
        progress: total ? Math.min(1, pos / total) : undefined,
        state: s.PlayState?.IsPaused ? "paused" : method || "playing",
        tone: method.toLowerCase().includes("transcode") ? "warn" : "good",
        meta: s.TranscodingInfo?.TranscodeReasons?.join(", "),
      } satisfies Activity;
    });

    const stats: Stat[] = [
      { label: "Now playing", value: String(playing.length), hint: transcoding.length ? `${transcoding.length} transcoding` : "all direct", tone: transcoding.length ? "warn" : playing.length ? "good" : "default" },
      { label: "Movies", value: compact(counts?.MovieCount ?? 0) },
      { label: "Episodes", value: compact(counts?.EpisodeCount ?? 0), hint: `${counts?.SeriesCount ?? 0} series` },
      { label: "Sessions", value: String((sessions ?? []).length), hint: "last 5 min" },
    ];

    return {
      id: "jellyfin",
      name: "Jellyfin",
      role,
      link,
      status: "up",
      version: info?.Version,
      latencyMs: Date.now() - started,
      stats,
      flags: runningTasks.slice(0, 2).map((t) => ({
        label: `${t.Name ?? "task"} ${Math.round(t.CurrentProgressPercentage ?? 0)}%`,
        on: true,
      })),
      activityLabel: "Sessions",
      activity,
    };
  } catch (err) {
    return down("jellyfin", "Jellyfin", role, link, err);
  }
}
