/** Health of one node in the graph.
 *
 *  `warn` means the service answered but told us something is wrong -- a health
 *  check failing in Radarr, a throttled provider in Bazarr. It is deliberately
 *  distinct from `down`, which means it did not answer at all. */
export type Status = "up" | "warn" | "down" | "unconfigured";

export type Tone = "default" | "good" | "warn" | "bad" | "accent";

/** A single number on a node card. The frontend renders these generically, so
 *  adding a metric here is the whole change -- no matching UI edit. */
export type Stat = {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  /** 0..1, drawn as a bar under the value. */
  progress?: number;
};

/** A row of live work: a download, a request, a playing session. */
export type Activity = {
  id: string;
  title: string;
  subtitle?: string;
  /** 0..1 */
  progress?: number;
  state?: string;
  tone?: Tone;
  meta?: string;
};

export type Snapshot = {
  id: string;
  name: string;
  role: string;
  link: string;
  status: Status;
  version?: string;
  latencyMs?: number;
  error?: string;
  stats: Stat[];
  /** Named booleans, drawn as the switch pills in the design. */
  flags?: { label: string; on: boolean }[];
  /** Feeds the detail drawer. */
  activity?: Activity[];
  activityLabel?: string;
};

export function unconfigured(id: string, name: string, role: string, link: string, what: string): Snapshot {
  return {
    id,
    name,
    role,
    link,
    status: "unconfigured",
    error: `${what} not set`,
    stats: [],
  };
}

export function down(id: string, name: string, role: string, link: string, err: unknown): Snapshot {
  return {
    id,
    name,
    role,
    link,
    status: "down",
    error: err instanceof Error ? err.message : String(err),
    stats: [],
  };
}

export function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function rate(n: number): string {
  return n > 0 ? `${bytes(n)}/s` : "idle";
}

export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function compact(n: number): string {
  if (!Number.isFinite(n)) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
