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
  links: Record<"grafana" | "dokploy" | "jellyfin" | "jellyseerr" | "cinema" | "immich", string>;
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
export type Range = "15m" | "1h" | "6h" | "24h" | "7d" | "14d" | "30d";

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

// ——— Storage ———————————————————————————————————————————————————————————————

/** Where a filesystem is heading, from a linear fit over the last week.
 *
 *  `bytesPerDay` is the change in *used* bytes, so a positive number is filling.
 *  Below the noise floor it is reported as steady rather than as a very small
 *  slope: a week of scrapes on a live filesystem always fits *some* gradient,
 *  and extrapolating that one to a date is how a dashboard invents a deadline. */
export type StorageTrend = {
  bytesPerDay: number | null;
  /** "+12 GiB/day", "−400 MiB/day", "steady", "—". */
  display: string;
  /** Days until free space reaches zero at that rate. Null unless it is filling. */
  daysToFull: number | null;
  /** "full in ~34 days", "not filling", "no history yet". */
  fullDisplay: string;
};

export type StorageMount = Filesystem & {
  instance: "homelab" | "nas";
  /** The same filesystem seen at another path — UGOS bind-mounts /volume1 onto
   *  /home, and counting both would double the NAS's capacity. Only the primary
   *  path is summed; the aliases are listed so the page can say why. */
  aliases: string[];
  /** The mount this machine's headline number is about: `/` on the mini PC, the
   *  pool on the NAS. */
  headline: boolean;
  health: Health;
  trend: StorageTrend;
};

export type StorageHost = {
  instance: "homelab" | "nas";
  name: string;
  role: string;
  /** False when Prometheus has no *current* filesystem sample for the machine —
   *  which is a missing answer, not an empty disk, and must never render as 0%. */
  reporting: boolean;
  /** When the numbers below were taken. Set only when they are the last known
   *  ones rather than fresh: a NAS that dropped off the tailnet an hour ago
   *  still has a pool, and blanking the card would hide a number that is almost
   *  certainly still true. Null when the machine is reporting normally, and null
   *  again once the last sample falls out of the lookback window. */
  asOf: string | null;
  sizeBytes: number | null;
  usedBytes: number | null;
  availBytes: number | null;
  percent: number | null;
  sizeDisplay: string;
  usedDisplay: string;
  availDisplay: string;
  health: Health;
  /** Every distinct filesystem, largest first. */
  mounts: StorageMount[];
  /** The machine's total, summed over distinct devices. */
  trend: StorageTrend;
};

/** The occupancy recap: both machines, their filesystems, and where the fill is
 *  going. Instant values only — the time series behind them are the panels on
 *  the same page, asked for by id like every other chart. */
export type StorageSummary = {
  at: string;
  hosts: StorageHost[];
  /** Only machines reporting *now*. A stale host's capacity is shown on its own
   *  card, where the page can say how old it is, and left out of a total that
   *  would otherwise read as current free space. */
  estate: {
    sizeBytes: number | null;
    usedBytes: number | null;
    availBytes: number | null;
    percent: number | null;
    sizeDisplay: string;
    usedDisplay: string;
    availDisplay: string;
  };
};

// ——— Logs ——————————————————————————————————————————————————————————————————

/** Shorter than the metric ranges on purpose. A log window is read, not
 *  watched, and 30 days of lines is not a thing a browser should be asked to
 *  hold. Declared as a union for the same reason `Range` is -- this file must
 *  stay types-only, so both sides keep their own list typed against it. */
export type LogRange = "5m" | "15m" | "1h" | "6h" | "24h" | "7d";

export type LogLevel = "error" | "warn" | "info" | "debug";

export type LogLine = {
  /** Stable across polls, so the tail can append without re-keying the list. */
  id: string;
  /** Unix nanoseconds, as a string: a double cannot hold one without losing the
   *  last few digits, and those digits are what orders two lines in the same
   *  millisecond. */
  ts: string;
  atMs: number;
  host: string;
  job: string;
  /** The container or the systemd unit -- whichever this stream has. */
  source: string;
  level: LogLevel | "unknown";
  line: string;
};

export type LogsResponse = {
  at: string;
  /** The LogQL the server assembled. Shown on the page, because a filter UI that
   *  hides what it asked for is impossible to debug from the outside. */
  query: string;
  lines: LogLine[];
  /** Newest nanosecond timestamp in this batch. Send it back as `since` and the
   *  next call returns only what arrived after it. */
  cursor: string | null;
  /** Loki returned exactly the limit, so there are older lines in this window
   *  that are not here. */
  truncated: boolean;
  grafana: string;
};

/** The live label sets, so the filter UI offers only streams that exist and the
 *  server can reject anything else. */
export type LogOptions = {
  hosts: string[];
  containers: string[];
  units: string[];
  levels: LogLevel[];
};

// ——— Containers ————————————————————————————————————————————————————————————

export type ContainerState =
  | "running"
  | "exited"
  | "created"
  | "paused"
  | "restarting"
  | "removing"
  | "dead"
  | "unknown";

export type ContainerHealth = "healthy" | "unhealthy" | "starting" | "none";

export type ContainerDetail = {
  /** Short id. The long one is never needed and is forty characters of noise in
   *  an audit line. */
  id: string;
  name: string;
  image: string;
  instance: "homelab" | "nas";
  state: ContainerState;
  /** Docker's own phrasing — "Up 3 days (healthy)", "Exited (137) 2 hours ago".
   *  Worth keeping verbatim: the exit code in it is often the whole answer. */
  status: string;
  health: ContainerHealth;
  createdMs: number | null;
  /** Only read for containers that are not simply running, because it costs an
   *  inspect call each and is only interesting when something is wrong. */
  restarts: number | null;
  compose?: { project: string; service: string };
  cpuPercent: number | null;
  rssBytes: number | null;
  rssDisplay: string;
  ports: string[];
  /** Whether the actions layer will touch it. False is not a permission the UI
   *  applies — the dispatcher refuses independently. */
  managed: boolean;
  /** Why not, when it is not. */
  reason?: string;
};

export type ContainersResponse = {
  at: string;
  /** `docker` sees stopped containers; `cadvisor` cannot. */
  source: "docker" | "cadvisor";
  /** Set when the list is degraded, saying what is missing from it. */
  notice?: string;
  counts: { running: number; stopped: number; total: number };
  containers: ContainerDetail[];
};

// ——— Actions ———————————————————————————————————————————————————————————————

export type ActionRisk = "low" | "medium" | "high";

/** What kind of thing the action needs pointing at, so the page can render the
 *  right control without knowing any action by name. */
export type ActionTargetKind = "container" | "dokploy" | "none";

export type ActionDef = {
  id: string;
  label: string;
  /** One line saying what will actually happen, shown before the click rather
   *  than in a tooltip after it. */
  description: string;
  risk: ActionRisk;
  /** Whether the UI must ask twice. The server refuses without `confirm` either
   *  way -- this only tells the page to expect that. */
  confirm: boolean;
  target: ActionTargetKind;
  /** Targets the caller may choose from, when the set is fixed and short. */
  choices?: { value: string; label: string }[];
  available: boolean;
  /** Why not, when it is not: almost always a credential that has never been
   *  collected on the box. */
  unavailable?: string;
  /** True when a second call does a second thing upstream -- a queued search, a
   *  second deploy. These are the ones the idempotency key is really for. */
  replayable: boolean;
};

export type ActionCatalog = { actions: ActionDef[] };

export type ActionOutcome = "ok" | "denied" | "failed" | "deduped";

export type ActionResult = {
  ok: boolean;
  action: string;
  target?: string;
  outcome: ActionOutcome;
  /** One line, for the toast and for the audit. They are the same sentence on
   *  purpose: what you were told and what was written down cannot disagree. */
  message: string;
  at: string;
};

export type AuditEntry = {
  at: string;
  action: string;
  target?: string;
  outcome: ActionOutcome;
  message: string;
  /** As far as it can be known -- cf-connecting-ip through the tunnel, and
   *  "local" for everything on the LAN, which shares one bucket. */
  from: string;
};

export type AuditResponse = {
  entries: AuditEntry[];
  path: string;
  /** False means the log cannot be appended to, which is not the same as empty
   *  and must never render as it. */
  writable: boolean;
};

// ——— Topology ——————————————————————————————————————————————————————————————

/** What a node is, which is also what it gets drawn as. `router` and `edge` are
 *  in here because a path crosses them, not because anything scrapes them. */
export type TopoKind = "host" | "nas" | "plug" | "router" | "edge" | "viewer";

/** How a link physically gets there. Colour follows this, not status -- a busy
 *  tailnet hop and a busy LAN hop are different things and read differently. */
export type Transport = "lan" | "tailnet" | "internet" | "tunnel" | "wifi";

export type TopoAddress = { value: string; kind: "lan" | "tailnet" | "public" | "none" };

export type TopoNode = {
  id: string;
  label: string;
  kind: TopoKind;
  site: "davide" | "ilario" | "cloud";
  /** What it is, in one line. */
  role: string;
  /** Every address it answers on, so the card can say which network each belongs
   *  to. Both flats are 192.168.15.0/24 and that is a coincidence, not a route. */
  addresses: TopoAddress[];
  status: Status;
  /** Why it is not `up`, or why it has no status to give at all. */
  note?: string;
  /** Empty for anything that is not scraped. Rendered generically, as everywhere
   *  else -- there is no per-metric branch on this page either. */
  metrics: Metric[];
  /** Only the two modelled machines carry these, and they are the same map the
   *  hero scene reads. */
  hotspots?: Record<string, HotspotState>;
  /** Names of alerts firing against this node, resolved from `Alert.instance`. */
  alerts: string[];
  /** In-app route, when the node has a page of its own. */
  href?: string;
};

export type TopoLink = {
  id: string;
  from: string;
  to: string;
  /** Drawn through this node when the path is not direct. The log push is one
   *  decision by one Alloy instance, so it is one link bent through the edge. */
  via?: string;
  transport: Transport;
  /** What moves and which way: "metrics, pulled" / "logs, pushed". */
  carries: string;
  status: Status;
  /** **null means nothing measures this path.** It must never be rendered as a
   *  zero: a zero is a measurement, and drawing the two alike is how a dashboard
   *  starts lying. */
  rate: { value: number; unit: Unit; display: string } | null;
  /** Set when the link is a poll rather than a stream, so the scene can fire one
   *  bead per interval instead of a continuous flow. This is the whole point of
   *  the page: you can watch Prometheus scrape. */
  cadenceS?: number;
  /** A scrape round trip, not ICMP -- there is no blackbox exporter in this
   *  estate. The card says so rather than implying a ping. */
  latencyMs?: number | null;
  /** One sentence: why this path exists, or why nothing measures it. */
  note: string;
};

export type TopoSite = {
  id: "davide" | "ilario" | "cloud";
  label: string;
  subnet?: string;
  note?: string;
};

export type Topology = {
  at: string;
  /** Same meaning as on `Summary`: the numbers below are the last good ones. */
  stale: boolean;
  sites: TopoSite[];
  nodes: TopoNode[];
  links: TopoLink[];
};

// ——— Media pipeline ————————————————————————————————————————————————————————

/** One number on a pipeline node.
 *
 *  Not `Metric`: these are not time series and most of them have no unit at all
 *  ("clean", "3 errors", "12.4 TiB ↓"). What they share with `Metric` is the
 *  rule that matters — the string is assembled on the server and the browser
 *  only prints it, so there is no second formatter to drift. Pushing one of
 *  these into a collector is the whole change; the node card renders the array
 *  generically and has no per-stat branch. */
export type MediaStat = {
  /** Stable within a node, so React can key on it and the busy rules can find
   *  a value without parsing a label. */
  id: string;
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  /** 0..1, drawn as a bar under the value. Absent when there is no ceiling. */
  fraction?: number;
};

/** A row of live work: a download, a request, a playing session. The drawer
 *  renders these generically too. */
export type MediaActivity = {
  id: string;
  title: string;
  subtitle?: string;
  /** 0..1 */
  fraction?: number;
  state?: string;
  tone?: Tone;
  meta?: string;
};

/** What a node is. `host` is the box itself: it carries the pipeline rather than
 *  taking part in it, and the page fills it from /api/summary rather than this
 *  payload, so the machine's numbers have exactly one source. */
export type MediaNodeKind = "service" | "host";

export type MediaNode = {
  id: string;
  kind: MediaNodeKind;
  label: string;
  /** What it does, in one line. */
  role: string;
  /** Where to send a browser. Public hostnames, never the address this process
   *  dials. */
  link: string;
  status: Status;
  /** Why it is not `up`, including which key has never been collected. */
  error?: string;
  version?: string;
  /** Round trip to the service's own status endpoint. Not a ping: nothing in
   *  this estate runs a blackbox exporter. */
  latencyMs?: number | null;
  stats: MediaStat[];
  /** Named booleans — a SignalR feed, an update waiting, a job running. */
  flags: { label: string; on: boolean }[];
  activity: MediaActivity[];
  activityLabel: string;
  /** What this service is costing the box right now, from cAdvisor. Null when
   *  the container is not running or cAdvisor cannot see it. */
  load: { cpuPercent: number; rssBytes: number | null; rssDisplay: string } | null;
  /** Laid out on the server, like the topology graph: the shape *is* the
   *  information — left to right is the path a request actually takes — so it is
   *  described once and both halves agree. */
  position: { x: number; y: number };
};

/** `feedback` is the availability edge, which runs against the pipeline: it is
 *  Jellyfin telling Jellyseerr the file finally exists. */
export type MediaEdgeKind = "forward" | "feedback" | "carries";

export type MediaEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: MediaEdgeKind;
  /** Whether something is moving along this link right now. Decided on the
   *  server from the collectors' own numbers rather than by parsing the stat
   *  strings back out of the payload, which is what mediarr-dash does. */
  active: boolean;
  /** One sentence: what makes this edge busy, so a still picture can be read. */
  note: string;
};

export type MediaPipeline = {
  at: string;
  /** True when the last good payload is being served because something missed
   *  its budget. Same meaning as on `Summary`. */
  stale: boolean;
  nodes: MediaNode[];
  edges: MediaEdge[];
  counts: { up: number; warn: number; down: number; unconfigured: number };
  /** Caveats that belong on the page rather than in a commit message. */
  notes: string[];
};

// ——— Ask ———————————————————————————————————————————————————————————————————
//
// What /api/ask turns a sentence into. Note what is *not* here: there is no
// expression, no query and no PromQL. A spec is a set of series ids the registry
// already knows, plus a range, a machine and a little presentation — exactly
// what the browser was already allowed to ask for. The model narrows a list; it
// never writes one.

/** A threshold drawn across a chart. The number comes from the prompt's own
 *  digits, never from the model: a model that emits no tokens cannot invent a
 *  limit that was never typed. */
export type AskThreshold = {
  value: number;
  unit: Unit;
  label: string;
};

export type ChartSpec = {
  /** `chart` renders panels; `table` ranks containers from /api/containers. */
  shape: "chart" | "table";
  /** Registry ids, already checked against the allow-list, highest confidence
   *  first. Capped, because four panels is the most an answer can be. */
  ids: string[];
  range: Range;
  /** `both` draws one panel per machine side by side, which is the comparison
   *  idiom the metrics pages already use. */
  instance: "homelab" | "nas" | "both";
  threshold?: AskThreshold;
  /** Only meaningful when shape is `table`. */
  rankBy?: "cpu" | "memory";
  limit?: number;
};

/** What the model understood, whether or not it was enough to render. Shown on a
 *  refusal so the answer is "here is what I read and why it was not enough"
 *  rather than a shrug. */
export type AskUnderstood = {
  range: Range;
  instance: "homelab" | "nas" | "both";
  shape: string;
  threshold?: AskThreshold;
  /** 0..1. How well the request mapped onto the catalogue at all. */
  fit: number;
  /** Every candidate the model scored, best first, for the "did you mean" chips.
   *  Carries the ones that did not clear the floor too — that is the point. */
  candidates: { id: string; title: string; score: number }[];
};

export type AskResponse = {
  at: string;
  prompt: string;
  understood: AskUnderstood;
  /** Absent when nothing cleared the floor. `reason` then says why. */
  spec?: ChartSpec;
  reason?: string;
  /** Grafana Explore, for the question this hub could not answer. */
  grafana?: string;
  /** Round trip to Jev, for the composer's footer. */
  tookMs: number;
};

/** Advertised on /api/ask/status so the CTA can grey itself out with a sentence
 *  before anyone types, the same way an action reports itself unavailable. */
export type AskStatus = { ok: true } | { ok: false; why: string };
