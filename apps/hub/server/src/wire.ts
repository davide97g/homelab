// The contract between the server and the browser. Types only: no imports, no
// runtime, nothing that can be executed.
//
// The frontend imports this file directly through the `@wire` Vite alias rather
// than keeping a parallel copy. mediarr-dash hand-mirrors its types between
// server/src/services/types.ts and frontend/src/lib/api.ts, and nothing catches
// a drift; that is survivable for one payload and not for this many.

/** Four states, because `warn` is not `down`: a machine answering with bad
 *  numbers is a different problem from a machine not answering. */
export type Status = "up" | "warn" | "down" | "unconfigured";

export type Tone = "default" | "good" | "warn" | "bad" | "accent";

export type Health = "ok" | "warn" | "bad" | "unknown";

export type Unit =
  | "percent"
  | "bytes"
  | "bytesPerSec"
  | "bitsPerSec"
  | "celsius"
  | "watts"
  | "kwh"
  | "eur"
  | "count"
  | "seconds"
  | "ratio"
  | "hertz";

/** One number on a card. Everything is pre-formatted server-side, so the
 *  browser never turns bytes into "1.4 GiB" and the two can never disagree.
 *
 *  Adding a number to a page is pushing one of these into `HostSummary.metrics`
 *  — the cards render the array generically and have no per-metric branch. */
export type Metric = {
  /** Stable id, and the series id where a matching time series exists. */
  id: string;
  label: string;
  value: number | null;
  unit: Unit;
  /** What to print. Already rounded and suffixed. */
  display: string;
  health: Health;
  /** 0..1, for gauges and bars. Absent when the metric has no natural ceiling. */
  fraction?: number;
  /** Small print under the number. */
  hint?: string;
};

/** Drives the 3D models and, on a phone, the flat SVG fallback. Computed on the
 *  server so the browser holds no metric-to-visual logic and both renderers are
 *  fed from one place. */
export type HotspotState = {
  /** 0..1 — emissive intensity. */
  level: number;
  tone: Tone;
  /** Pulses per second. 0 is steady. */
  pulse: number;
  label: string;
  value: string;
};

export type HostSummary = {
  id: "homelab" | "nas";
  name: string;
  /** What it is, in one line, for the card header. */
  role: string;
  status: Status;
  /** Why it is not `up`. */
  error?: string;
  uptimeS: number | null;
  metrics: Metric[];
  hotspots: Record<string, HotspotState>;
};

export type PowerSummary = {
  wallW: number | null;
  packageW: number | null;
  kwhPerDay: number | null;
  eurPerMonth: number | null;
  /** Whether wall power is measured at the plug or modelled from the APU rail. */
  source: "plug" | "model";
  /** The tariff the euro figure used, so the page can say which. */
  costPerKwh: number;
};

export type Alert = {
  name: string;
  severity: "critical" | "warning" | "none";
  state: "pending" | "firing";
  since: string;
  summary: string;
  instance?: string;
};

export type ContainerRow = {
  name: string;
  instance: "homelab" | "nas";
  /** Always a number: a container cAdvisor can see has a CPU rate, even if it is
   *  zero. Memory can genuinely be missing, so that one is nullable. */
  cpuPercent: number;
  rssBytes: number | null;
  rssDisplay: string;
};

export type ContainerSummary = {
  /** Counted from cAdvisor, so this is "containers cAdvisor can see", which is
   *  every running one. Stopped containers need the Docker API and are not here. */
  total: number;
  byInstance: { homelab: number; nas: number };
  top: ContainerRow[];
};

export type Summary = {
  at: string;
  /** True when at least one source missed its budget and the numbers below are
   *  the last good ones rather than fresh. */
  stale: boolean;
  hosts: { homelab: HostSummary; nas: HostSummary };
  power: PowerSummary;
  alerts: Alert[];
  containers: ContainerSummary;
  links: Record<"grafana" | "dokploy" | "mediarr" | "jellyfin" | "jellyseerr" | "cinema" | "immich", string>;
};

export type SessionResponse = { authenticated: boolean };
export type ErrorResponse = { error: string };

// ——— Time series ———————————————————————————————————————————————————————————

export type SeriesKind = "line" | "area" | "stack" | "bar";

export type SeriesLine = {
  key: string;
  label: string;
  /** Aligned to the frame's `t`. null is a genuine gap, not a zero. */
  values: (number | null)[];
  /** A chart token name (`chart-1`..`chart-8`) or a tone name. Never a literal
   *  colour: the canvas resolves it against the CSS variables so it follows the
   *  theme. */
  color?: string;
  area?: boolean;
  dashed?: boolean;
  /** Drawn below the axis. Used for transmit against receive. */
  mirror?: boolean;
};

export type SeriesFrame = {
  id: string;
  title: string;
  description?: string;
  unit: Unit;
  kind: SeriesKind;
  /** Shared x axis, unix seconds, ascending and evenly spaced by stepS. */
  t: number[];
  lines: SeriesLine[];
  stepS: number;
  domain?: [number | null, number | null];
  /** Set when this frame alone failed; the rest of the response still stands. */
  error?: string;
  /** Deep link into Grafana Explore for the same expressions and range, built
   *  server-side. The escape hatch for anything the registry does not cover. */
  grafana?: string;
};

export type SeriesResponse = {
  at: string;
  rangeS: number;
  stepS: number;
  frames: SeriesFrame[];
};

/** What /api/catalog returns: enough for a page to lay itself out without
 *  hard-coding a single expression. */
export type CatalogEntry = {
  id: string;
  title: string;
  description?: string;
  unit: Unit;
  kind: SeriesKind;
  instances: ("homelab" | "nas")[];
};

/** The ranges the series endpoint accepts. A union rather than a const array
 *  because this file must stay types-only — a value here would become a real
 *  runtime import in the browser bundle. Both sides declare their own
 *  `Range[]` list, typed against this, so a mismatch fails to compile. */
export type Range = "15m" | "1h" | "6h" | "24h" | "7d" | "30d";

// ——— The NAS page ——————————————————————————————————————————————————————————

/** One physical bay. Four of them exist whatever is plugged in, because an
 *  empty bay is information: it is why the array has no redundancy. */
export type NasBay = {
  /** 0-based, front to back as the chassis is labelled 1..4. */
  index: number;
  occupied: boolean;
  /** Kernel name of the disk in this bay, when there is one. */
  device?: string;
  sizeBytes?: number | null;
  sizeDisplay?: string;
  rotational?: boolean;
  /** Read + write right now, so a working bay can be seen working. */
  ioBytesPerSec?: number | null;
  ioDisplay?: string;
  /** Always null on this machine: smartctl is not installed on UGOS, so disk
   *  health and drive temperature genuinely cannot be read. Kept in the shape
   *  rather than omitted, so the page can say that rather than imply health. */
  tempC?: number | null;
  label: string;
};

/** An md array as node_exporter reports it, plus the honest reading of it.
 *
 *  node_exporter does not export the RAID *level*, so nothing here claims one.
 *  What it does export is how many members the array requires, and that is the
 *  number that matters: an array requiring one disk has no redundancy however
 *  it is labelled, and `node_md_degraded` reads 0 right up to the moment that
 *  disk dies. */
export type RaidArray = {
  device: string;
  state: string;
  active: number;
  failed: number;
  spare: number;
  required: number;
  degraded: boolean;
  redundancy: "none" | "redundant" | "unknown";
  /** One sentence saying what the numbers above actually mean. */
  note: string;
  /** 0..1 while resyncing or recovering, null when fully in sync. */
  syncFraction: number | null;
};

export type SensorRow = {
  key: string;
  chip: string;
  label: string;
  tempC: number | null;
  display: string;
  health: Health;
};

export type Filesystem = {
  mountpoint: string;
  device: string;
  fstype: string;
  sizeBytes: number | null;
  usedBytes: number | null;
  availBytes: number | null;
  percent: number | null;
  sizeDisplay: string;
  usedDisplay: string;
  availDisplay: string;
};

export type NasDetail = {
  at: string;
  host: HostSummary;
  /** From node_uname_info, so it is what the box calls itself. */
  nodename: string | null;
  kernel: string | null;
  pool: Filesystem | null;
  filesystems: Filesystem[];
  arrays: RaidArray[];
  bays: NasBay[];
  sensors: SensorRow[];
  containers: ContainerRow[];
  /** Package power from RAPL. There is no plug on this machine, so this is the
   *  CPU package and nothing else -- not the disk, the board or the brick. */
  packageW: number | null;
  links: { cinema: string; immich: string };
  /** Caveats that belong on the page rather than in a commit message. */
  notes: string[];
};
