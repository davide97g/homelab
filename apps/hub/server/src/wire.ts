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
