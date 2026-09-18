import { Cache } from "../cache.js";
import { config } from "../config.js";
import type { CatalogEntry, Range, SeriesFrame, SeriesLine, SeriesResponse } from "../wire.js";
import { netDevice } from "../collect/host.js";
import { range as promRange } from "./client.js";
import { RANGE_SECONDS, SERIES, type Ctx, type Instance, type SeriesDef } from "./registry.js";

const cache = new Cache(15_000);

/** The server's copy of the accepted ranges. Typed as Range[], so if wire.ts's
 *  union and this list ever disagree the build fails rather than a request. */
export const RANGES: Range[] = ["15m", "1h", "6h", "24h", "7d", "30d"];

/** ~600 points is what a chart that wide can actually show, and the ceiling that
 *  keeps a 30 day range from asking for 172 800 samples per series. */
const TARGET_POINTS = 600;

/** How often each machine is actually scraped. This is not decoration: a rate
 *  window narrower than two scrape intervals contains one sample and returns
 *  nothing at all. The NAS is scraped every 60 s over a tailnet hop, so a step
 *  and window sized for the mini PC's 15 s silently produced empty panels. */
const SCRAPE_S: Record<Instance, number> = { homelab: 15, nas: 60 };

function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function stepFor(def: SeriesDef, rangeS: number, instance: Instance): number {
  return Math.max(def.minStepS, SCRAPE_S[instance], Math.ceil(rangeS / TARGET_POINTS));
}

/** `{{label}}` substitution, as in Grafana. An unmatched placeholder collapses
 *  to nothing rather than printing braces at the reader. */
function legendFor(template: string, labels: Record<string, string>): string {
  const out = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => labels[key] ?? "").trim();
  return out || template.replace(/\{\{\w+\}\}/g, "").trim() || "value";
}

/** A deep link into Grafana Explore carrying the same expressions and window.
 *
 *  This is what makes the allow-list affordable: the registry never has to cover
 *  every question, because the next question is one click away in the tool built
 *  for it. */
function grafanaLink(exprs: string[], rangeS: number): string {
  const pane = {
    datasource: "prometheus",
    queries: exprs.map((expr, i) => ({
      refId: String.fromCharCode(65 + i),
      expr,
      datasource: { type: "prometheus", uid: "prometheus" },
    })),
    range: { from: `now-${formatDuration(rangeS)}`, to: "now" },
  };
  const panes = encodeURIComponent(JSON.stringify({ hub: pane }));
  return `${config.links.grafana}/explore?schemaVersion=1&panes=${panes}&orgId=1`;
}

async function buildFrame(id: string, def: SeriesDef, instance: Instance, rangeS: number): Promise<SeriesFrame> {
  const stepS = stepFor(def, rangeS, instance);
  const endS = Math.floor(Date.now() / 1000 / stepS) * stepS;
  const startS = endS - rangeS;

  // A rate needs at least two scrapes inside its window, so the floor is four
  // scrape intervals rather than a flat minute.
  const windowS = Math.max(stepS * 4, SCRAPE_S[instance] * 4);
  const ctx: Ctx = {
    instance,
    rangeS,
    stepS,
    window: formatDuration(windowS),
    device: (await netDevice(instance)) ?? "",
    smooth: formatDuration(Math.max(300, stepS * 8)),
  };

  const rendered = def.exprs.map((e) => e.expr(ctx));

  const base: SeriesFrame = {
    id,
    title: def.title,
    unit: def.unit,
    kind: def.kind,
    t: [],
    lines: [],
    stepS,
    grafana: grafanaLink(rendered, rangeS),
  };
  if (def.description) base.description = def.description;
  if (def.domain) base.domain = def.domain;

  // A device-dependent panel with no device resolved has nothing to ask for.
  if (!ctx.device && rendered.some((e) => e.includes('device=""'))) {
    return { ...base, error: "no active network interface on this machine" };
  }

  try {
    const results = await Promise.all(rendered.map((expr) => promRange(expr, startS, endS, stepS)));

    // Prometheus returns only the timestamps each series actually has, and
    // different series can differ. One shared axis is built here and every line
    // is aligned onto it, so a gap stays a gap instead of shifting the line.
    const t: number[] = [];
    for (let ts = startS; ts <= endS; ts += stepS) t.push(ts);
    const index = new Map(t.map((ts, i) => [ts, i]));

    const lines: SeriesLine[] = [];
    results.forEach((series, exprIndex) => {
      const meta = def.exprs[exprIndex]!;
      for (const s of series) {
        const values: (number | null)[] = new Array(t.length).fill(null);
        for (const [ts, v] of s.points) {
          const i = index.get(Math.round(ts / stepS) * stepS);
          if (i !== undefined) values[i] = v;
        }
        const line: SeriesLine = {
          key: `${exprIndex}:${JSON.stringify(s.labels)}`,
          label: legendFor(meta.legend, s.labels),
          values,
        };
        if (meta.color) line.color = meta.color;
        if (meta.area) line.area = true;
        if (meta.dashed) line.dashed = true;
        if (meta.mirror) line.mirror = true;
        lines.push(line);
      }
    });

    // Stable ordering so colours do not reshuffle between polls when Prometheus
    // returns topk in a different order. Sorted by key, not label: the key is
    // prefixed with the expression's index, which keeps declared order across
    // expressions -- load average reads 1m, 5m, 15m rather than alphabetically
    // as 15m, 1m, 5m -- while still being deterministic within one expression.
    lines.sort((a, b) => a.key.localeCompare(b.key));

    return { ...base, t, lines };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

export function catalog(): CatalogEntry[] {
  return Object.entries(SERIES).map(([id, def]) => {
    const entry: CatalogEntry = {
      id,
      title: def.title,
      unit: def.unit,
      kind: def.kind,
      instances: def.instances,
    };
    if (def.description) entry.description = def.description;
    return entry;
  });
}

export type SeriesRequest = { ids: string[]; range: Range; instance: Instance };

/** Parses and clamps everything the browser sent. Anything unrecognised is
 *  dropped rather than passed through, so the only PromQL that ever reaches
 *  Prometheus is what the registry wrote. */
export function parseRequest(params: URLSearchParams): SeriesRequest | { error: string } {
  const rawIds = (params.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (rawIds.length === 0) return { error: "no series ids given" };
  if (rawIds.length > 12) return { error: "too many series in one request" };

  const unknown = rawIds.filter((id) => !(id in SERIES));
  if (unknown.length > 0) return { error: `unknown series: ${unknown.join(", ")}` };

  const rangeRaw = params.get("range") ?? "6h";
  if (!RANGES.includes(rangeRaw as Range)) return { error: `unknown range: ${rangeRaw}` };

  const instanceRaw = params.get("instance") ?? "homelab";
  if (instanceRaw !== "homelab" && instanceRaw !== "nas") {
    return { error: `unknown instance: ${instanceRaw}` };
  }

  return { ids: rawIds, range: rangeRaw as Range, instance: instanceRaw };
}

/** One in-flight frame per requested id, each resolving on its own.
 *
 *  Kept separate from `series` so the streaming route can hand a frame to the
 *  browser the moment it lands. A cold page used to be as slow as its slowest
 *  panel — every chart sat empty while one NAS query crawled over the tailnet —
 *  and the work was already parallel; only the reply was not. */
export function rangeSeconds(range: Range): number {
  return RANGE_SECONDS[range];
}

export function frames(req: SeriesRequest): Promise<SeriesFrame>[] {
  const rangeS = RANGE_SECONDS[req.range];

  return req.ids.map((id) => {
    const def = SERIES[id]!;
    if (!def.instances.includes(req.instance)) {
      // Asked for on a machine it does not apply to -- power on the NAS, say.
      // An empty frame with a reason beats a 400 that fails the whole batch.
      return Promise.resolve<SeriesFrame>({
        id,
        title: def.title,
        unit: def.unit,
        kind: def.kind,
        t: [],
        lines: [],
        stepS: def.minStepS,
        error: `not collected for ${req.instance}`,
      });
    }
    const key = `series:${id}:${req.instance}:${req.range}`;
    const ttl = Math.min(Math.max(stepFor(def, rangeS, req.instance) * 1000, 4000), 30_000);
    return cache.get(key, () => buildFrame(id, def, req.instance, rangeS), ttl);
  });
}

/** Batched on purpose: one request per page tick carrying every panel's ids.
 *  Fourteen panels polling individually would be 2.8 req/s against Prometheus
 *  from a single tab. */
export async function series(req: SeriesRequest): Promise<SeriesResponse> {
  const settled = await Promise.all(frames(req));
  const stepS = Math.max(...settled.map((f) => f.stepS));
  return { at: new Date().toISOString(), rangeS: RANGE_SECONDS[req.range], stepS, frames: settled };
}
