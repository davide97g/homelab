import { Cache } from "../cache.js";
import { config } from "../config.js";
import type { LogLevel, LogLine, LogOptions, LogRange, LogsResponse } from "../wire.js";
import { instantMetric, labelValues, queryRange } from "./client.js";

// The browser sends structured filters; this file assembles the LogQL. It never
// receives a query.
//
// Same discipline as the series registry, and for a sharper reason. A stream
// selector is mandatory in LogQL, but `{job=~".+"}` is a legal one, and over a
// 30 day window that is every line the stack has ever written. Assembling the
// selector here means it cannot be omitted or widened by a caller.
//
// Two more things a pass-through would give away. `contains` becomes an escaped
// `|=` rather than a regex, because there is no reliable way to detect a
// catastrophically backtracking pattern before running it. And `container` and
// `unit` are checked against the live label-value set, so a caller cannot name a
// stream that does not exist and have Loki scan for it.

const RANGE_SECONDS: Record<LogRange, number> = {
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
  "24h": 86400,
  "7d": 604800,
};

export const LOG_RANGES: LogRange[] = ["5m", "15m", "1h", "6h", "24h", "7d"];
export const LOG_LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 300;

/** Two vocabularies for the same idea, because they come from two places.
 *
 *  `level` is a real stream label and only journal streams have one -- Alloy
 *  sets it from the syslog priority keyword, so it speaks syslog: err, warning,
 *  notice. Docker streams have no level label at all; what they have is
 *  `detected_level`, which Loki infers at ingest and which speaks the usual
 *  application vocabulary: error, warn, critical, fatal.
 *
 *  A filter that knew only one of the two would silently return nothing for half
 *  the stack, which is exactly the shape of bug that looks like "there are no
 *  errors". */
const LEVEL_MATCH: Record<LogLevel, { journal: string[]; detected: string[] }> = {
  error: { journal: ["emerg", "alert", "crit", "err"], detected: ["error", "critical", "fatal"] },
  warn: { journal: ["warning"], detected: ["warn", "warning"] },
  info: { journal: ["notice", "info"], detected: ["info"] },
  debug: { journal: ["debug"], detected: ["debug", "trace"] },
};

const labelCache = new Cache(60_000);

/** A LogQL string literal. Backslash first, or the escaping escapes itself. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A value used inside a regex alternation. Everything that is not a plain
 *  identifier character is escaped, which is safe here because every value that
 *  reaches this function is a label value we already matched against the live
 *  set or a constant from LEVEL_MATCH. */
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function values(label: string): Promise<string[]> {
  return labelCache.get(`label:${label}`, () => labelValues(label).catch(() => []));
}

export async function logOptions(): Promise<LogOptions> {
  const [hosts, containers, units] = await Promise.all([values("host"), values("container"), values("unit")]);
  return {
    hosts: hosts.slice().sort(),
    containers: containers.slice().sort(),
    // The journal is full of `session-123.scope` units, one per login, which are
    // noise in a picker and would push the real services off the end of it.
    units: units.filter((u) => !/^session-\d+\.scope$/.test(u)).sort(),
    levels: LOG_LEVELS,
  };
}

export type LogRequest = {
  range: LogRange;
  host: string | null;
  container: string | null;
  unit: string | null;
  levels: LogLevel[];
  contains: string | null;
  limit: number;
  /** Nanosecond cursor. Present means "only what arrived after this", which is
   *  how the tail polls without re-fetching what it already has. */
  since: string | null;
};

export async function parseLogRequest(
  params: URLSearchParams,
): Promise<LogRequest | { error: string }> {
  const rangeRaw = params.get("range") ?? "1h";
  if (!LOG_RANGES.includes(rangeRaw as LogRange)) return { error: `unknown range: ${rangeRaw}` };

  const [hosts, containers, units] = await Promise.all([values("host"), values("container"), values("unit")]);

  const host = params.get("host");
  if (host && !hosts.includes(host)) return { error: `unknown host: ${host}` };

  const container = params.get("container");
  if (container && !containers.includes(container)) return { error: `unknown container: ${container}` };

  const unit = params.get("unit");
  if (unit && !units.includes(unit)) return { error: `unknown unit: ${unit}` };

  if (container && unit) return { error: "a stream is either a container or a unit, not both" };

  const levels = (params.get("levels") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknownLevel = levels.find((l) => !LOG_LEVELS.includes(l as LogLevel));
  if (unknownLevel) return { error: `unknown level: ${unknownLevel}` };

  const containsRaw = (params.get("contains") ?? "").trim();
  if (containsRaw.length > 200) return { error: "search text is too long" };

  const limitRaw = Number(params.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw))) : DEFAULT_LIMIT;

  const sinceRaw = params.get("since");
  // Nanoseconds only ever arrive as digits. Anything else is not a cursor this
  // server issued, so it is dropped rather than repaired.
  const since = sinceRaw && /^\d{1,20}$/.test(sinceRaw) ? sinceRaw : null;

  return {
    range: rangeRaw as LogRange,
    host: host || null,
    container: container || null,
    unit: unit || null,
    levels: levels as LogLevel[],
    contains: containsRaw || null,
    limit,
    since,
  };
}

export function buildQuery(req: LogRequest): string {
  const selectors: string[] = [];

  // The selector can never be empty: with no host chosen it still pins to the
  // two that exist rather than falling through to everything.
  selectors.push(req.host ? `host=${quote(req.host)}` : `host=~"homelab|nas"`);

  if (req.container) selectors.push(`container=${quote(req.container)}`, `job="docker"`);
  else if (req.unit) selectors.push(`unit=${quote(req.unit)}`, `job="journal"`);

  let query = `{${selectors.join(",")}}`;

  if (req.contains) {
    // `|=` is a literal substring match, not a pattern. A user regex would let
    // one filter box stall the whole read path, and there is no way to detect a
    // pathological pattern reliably before running it.
    query += ` |= ${quote(req.contains)}`;
  }

  if (req.levels.length > 0 && req.levels.length < LOG_LEVELS.length) {
    const journal = req.levels.flatMap((l) => LEVEL_MATCH[l].journal).map(escapeRe).join("|");
    const detected = req.levels.flatMap((l) => LEVEL_MATCH[l].detected).map(escapeRe).join("|");
    // A stream that lacks the label compares as empty, so the `or` is what makes
    // one filter work across both vocabularies.
    query += ` | level=~"${journal}" or detected_level=~"${detected}"`;
  }

  return query;
}

function levelOf(labels: Record<string, string>): LogLine["level"] {
  const raw = (labels.level ?? labels.detected_level ?? "").toLowerCase();
  for (const level of LOG_LEVELS) {
    if (LEVEL_MATCH[level].journal.includes(raw) || LEVEL_MATCH[level].detected.includes(raw)) return level;
  }
  return "unknown";
}

function grafanaLink(query: string, rangeS: number): string {
  const pane = {
    datasource: "loki",
    queries: [{ refId: "A", expr: query, queryType: "range", datasource: { type: "loki", uid: "loki" } }],
    range: { from: `now-${rangeS}s`, to: "now" },
  };
  const panes = encodeURIComponent(JSON.stringify({ hub: pane }));
  return `${config.links.grafana}/explore?schemaVersion=1&panes=${panes}&orgId=1`;
}

export async function logs(req: LogRequest): Promise<LogsResponse> {
  const query = buildQuery(req);
  const rangeS = RANGE_SECONDS[req.range];
  const nowNs = BigInt(Date.now()) * 1_000_000n;

  // A tail starts one nanosecond after the last line already on screen, so the
  // boundary line is never delivered twice and never skipped.
  const startNs = req.since ? BigInt(req.since) + 1n : nowNs - BigInt(rangeS) * 1_000_000_000n;
  const direction = req.since ? "forward" : "backward";

  const streams = await queryRange({
    query,
    startNs: startNs.toString(),
    endNs: nowNs.toString(),
    limit: req.limit,
    direction,
  });

  const lines: LogLine[] = [];
  for (const stream of streams) {
    const host = stream.labels.host ?? "?";
    const job = stream.labels.job ?? "?";
    const source = stream.labels.container ?? stream.labels.unit ?? stream.labels.identifier ?? job;
    const level = levelOf(stream.labels);
    for (const [ts, line] of stream.values) {
      lines.push({
        id: `${ts}:${source}`,
        ts,
        atMs: Number(BigInt(ts) / 1_000_000n),
        host,
        job,
        source,
        level,
        line,
      });
    }
  }

  // Loki returns one block per stream, each internally ordered; a single ordered
  // list only exists after merging them. Compared as BigInt because two lines in
  // the same millisecond differ only in digits a double has already lost.
  lines.sort((a, b) => (BigInt(a.ts) < BigInt(b.ts) ? -1 : BigInt(a.ts) > BigInt(b.ts) ? 1 : 0));

  const newest = lines[lines.length - 1]?.ts ?? null;

  return {
    at: new Date().toISOString(),
    query,
    lines,
    cursor: newest ?? req.since,
    truncated: lines.length >= req.limit,
    grafana: grafanaLink(query, rangeS),
  };
}

/** Evidence that the log path from the NAS is alive, for the topology page.
 *
 *  There is no metric anywhere for the Cloudflare tunnel or for Access: both are
 *  a host `cloudflared` service that exports nothing here. What *is* observable
 *  is whether lines the NAS pushed have arrived, and that single fact clears the
 *  whole chain at once -- Alloy is running, it has egress, Access accepted the
 *  service token, the ingress rule still matches, and Loki wrote them.
 *
 *  So the edge node's status is evidence rather than a measurement, and the card
 *  says exactly that. `lastAtMs` is null when nothing has arrived in the window,
 *  which is not the same as zero and must not render as "0 s ago".
 *
 *  The selector is a constant. Nothing here takes a caller's string. */
export async function nasLogPulse(): Promise<{ linesPerSec: number | null; lastAtMs: number | null }> {
  const endMs = Date.now();
  const startMs = endMs - 3600_000;

  const [linesPerSec, newest] = await Promise.all([
    instantMetric('sum(rate({host="nas"}[5m]))').catch(() => null),
    queryRange({
      query: '{host="nas"}',
      startNs: String(startMs * 1e6),
      endNs: String(endMs * 1e6),
      limit: 1,
      direction: "backward",
    }).catch(() => []),
  ]);

  // Nanoseconds as a string: a double cannot hold one, and only the millisecond
  // part is wanted here anyway.
  const ts = newest[0]?.values[0]?.[0];
  const lastAtMs = ts ? Math.floor(Number(ts.slice(0, -6))) : null;

  return { linesPerSec, lastAtMs: Number.isFinite(lastAtMs) ? lastAtMs : null };
}
