import { config } from "../../config.js";
import { bytes, duration, rate } from "../../format.js";
import { ServiceError } from "../../http.js";
import type { MediaActivity } from "../../wire.js";
import { qbitConfigured, qbitGet } from "../clients.js";
import { cap, Collected, down, unconfigured } from "./shape.js";

type Transfer = {
  dl_info_speed?: number;
  up_info_speed?: number;
  connection_status?: string;
};
type Torrent = {
  hash: string;
  name?: string;
  progress?: number;
  state?: string;
  dlspeed?: number;
  size?: number;
  eta?: number;
  num_seeds?: number;
  num_leechs?: number;
  category?: string;
};
type MainData = {
  server_state?: { alltime_dl?: number; alltime_ul?: number; free_space_on_disk?: number; global_ratio?: string };
};

// States that mean work is happening, as opposed to seeding or paused.
const ACTIVE = new Set(["downloading", "forcedDL", "metaDL", "stalledDL", "checkingDL", "allocating"]);
const PAUSED = new Set(["pausedDL", "pausedUP", "stoppedDL", "stoppedUP"]);
// An ETA of 8 640 000 is qBittorrent's "no idea", not a hundred days.
const NO_ETA = 8_640_000;

export async function collectQbittorrent(): Promise<Collected> {
  const role = "Transfers — downloads";
  const link = config.links.qbittorrent;
  if (!qbitConfigured()) {
    return unconfigured("qbittorrent", "qBittorrent", role, link, "QBITTORRENT_USER / QBITTORRENT_PASS");
  }

  const started = Date.now();
  try {
    const [transfer, torrents, main] = await Promise.all([
      qbitGet<Transfer>("/api/v2/transfer/info"),
      qbitGet<Torrent[]>("/api/v2/torrents/info?filter=all&sort=progress"),
      // Only the all-time totals come from here, and a sync call is the one
      // thing in this payload that is genuinely optional.
      qbitGet<MainData>("/api/v2/sync/maindata?rid=0").catch(() => ({}) as MainData),
    ]);

    const active = torrents.filter((t) => ACTIVE.has(t.state ?? ""));
    const seeding = torrents.filter(
      (t) => (t.state ?? "").toLowerCase().includes("up") && !PAUSED.has(t.state ?? ""),
    );
    const errored = torrents.filter((t) => t.state === "error" || t.state === "missingFiles");
    const dl = transfer.dl_info_speed ?? 0;
    const up = transfer.up_info_speed ?? 0;
    const server = main.server_state ?? {};
    const online = (transfer.connection_status ?? "").toLowerCase() === "connected";
    const free = server.free_space_on_disk ?? 0;

    const activity: MediaActivity[] = cap(
      torrents
        .slice()
        .sort((a, b) => {
          const rank = (t: Torrent) => (ACTIVE.has(t.state ?? "") ? 1 : 0);
          return rank(b) - rank(a) || (b.dlspeed ?? 0) - (a.dlspeed ?? 0);
        })
        .map((t): MediaActivity => {
          const row: MediaActivity = {
            id: t.hash,
            title: t.name ?? t.hash.slice(0, 12),
            subtitle: [
              t.category,
              bytes(t.size ?? 0),
              (t.dlspeed ?? 0) > 0 ? rate(t.dlspeed ?? 0) : null,
              (t.eta ?? 0) > 0 && (t.eta ?? 0) < NO_ETA ? `ETA ${duration(t.eta ?? 0)}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
            tone: errored.includes(t)
              ? "bad"
              : ACTIVE.has(t.state ?? "")
                ? "accent"
                : (t.progress ?? 0) >= 1
                  ? "good"
                  : "default",
            meta: `${t.num_seeds ?? 0}S / ${t.num_leechs ?? 0}L`,
          };
          if (t.state) row.state = t.state;
          if (t.progress !== undefined) row.fraction = t.progress;
          return row;
        }),
    );

    return {
      node: {
        id: "qbittorrent",
        label: "qBittorrent",
        role,
        link,
        // Connected with a broken torrent is degraded; disconnected is degraded
        // too — it answered, it simply has no peers to answer about.
        status: errored.length || !online ? "warn" : "up",
        latencyMs: Date.now() - started,
        stats: [
          { id: "down", label: "Download", value: dl > 0 ? rate(dl) : "idle", tone: dl > 0 ? "accent" : "default" },
          { id: "up", label: "Upload", value: up > 0 ? rate(up) : "idle", tone: up > 0 ? "good" : "default" },
          {
            id: "torrents",
            label: "Torrents",
            value: String(torrents.length),
            hint: `${active.length} active · ${seeding.length} seeding`,
            tone: errored.length ? "bad" : "default",
          },
          {
            id: "free",
            label: "Free space",
            value: bytes(free),
            tone: free < 50e9 ? "warn" : "good",
          },
          {
            id: "alltime",
            label: "All time",
            value: `${bytes(server.alltime_dl ?? 0)} ↓`,
            hint: `${bytes(server.alltime_ul ?? 0)} ↑ · ratio ${server.global_ratio ?? "—"}`,
          },
        ],
        flags: [{ label: transfer.connection_status ?? "unknown", on: online }],
        activity,
        activityLabel: "Torrents",
      },
      flow: {
        downBytesPerSec: dl,
        upBytesPerSec: up,
        active: active.length,
        errored: errored.length,
        torrents: torrents.length,
      },
    };
  } catch (err) {
    // 403 here is the Web UI wanting a login: the hub reaches qBittorrent from a
    // container, so its "bypass authentication for localhost" default never
    // applies. Worth saying, because the button that fixes it is in qBittorrent.
    const refused = err instanceof ServiceError && err.status === 403;
    return down(
      "qbittorrent",
      "qBittorrent",
      role,
      link,
      refused ? new ServiceError("qBittorrent refused the session — check QBITTORRENT_USER / QBITTORRENT_PASS") : err,
    );
  }
}
