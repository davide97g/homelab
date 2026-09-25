/* Shapes returned by qBittorrent 5.2.3 / WebAPI 2.15.1.
 *
 * Verified against the live box. Two traps are encoded here deliberately:
 *   - several server_state counters are JSON strings, not numbers
 *   - `torrents` is absent from maindata when there are none, not empty */

/** qBittorrent 5.x renamed pause -> stop. `pausedDL` / `pausedUP` do not exist
 *  in the 5.2.3 binary; do not add them back from 4.x documentation. */
export type TorrentState =
  | "error"
  | "missingFiles"
  | "uploading"
  | "stoppedUP"
  | "queuedUP"
  | "stalledUP"
  | "checkingUP"
  | "forcedUP"
  | "allocating"
  | "downloading"
  | "metaDL"
  | "forcedMetaDL"
  | "stoppedDL"
  | "queuedDL"
  | "stalledDL"
  | "checkingDL"
  | "forcedDL"
  | "checkingResumeData"
  | "moving"
  | "unknown";

export type Torrent = {
  hash: string;
  name: string;
  state: TorrentState;
  progress: number;
  size: number;
  total_size: number;
  downloaded: number;
  uploaded: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  ratio: number;
  category: string;
  tags: string;
  num_seeds: number;
  num_leechs: number;
  num_complete: number;
  num_incomplete: number;
  added_on: number;
  completion_on: number;
  last_activity: number;
  seeding_time: number;
  time_active: number;
  save_path: string;
  content_path: string;
  tracker: string;
};

export type ServerState = {
  alltime_dl: number;
  alltime_ul: number;
  connection_status: "connected" | "firewalled" | "disconnected";
  dht_nodes: number;
  dl_info_speed: number;
  dl_rate_limit: number;
  free_space_on_disk: number;
  up_info_speed: number;
  up_rate_limit: number;
  use_alt_speed_limits: boolean;
  /** The server's own suggested poll interval, in ms. Currently 1500. */
  refresh_interval: number;
  total_peer_connections: number;
  /** String in the JSON, not a number. */
  global_ratio: string;
};

export type Category = { name: string; savePath: string };

export type MainData = {
  rid: number;
  full_update?: boolean;
  /** Absent entirely when the client holds no torrents. */
  torrents?: Record<string, Partial<Torrent>>;
  torrents_removed?: string[];
  categories?: Record<string, Category>;
  categories_removed?: string[];
  server_state?: Partial<ServerState>;
};

export type TorrentFile = {
  index: number;
  name: string;
  size: number;
  progress: number;
  priority: number;
};

export type Tracker = {
  url: string;
  status: number;
  num_peers: number;
  num_seeds: number;
  msg: string;
};

export type Peer = {
  ip: string;
  port: number;
  client: string;
  progress: number;
  dl_speed: number;
  up_speed: number;
  country?: string;
};
