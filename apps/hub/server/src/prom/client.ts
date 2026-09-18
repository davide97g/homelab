import { config } from "../config.js";
import { getJson } from "../http.js";

// A thin client over the Prometheus HTTP API. Deliberately not copied from
// mediarr-dash's services/prometheus.ts, which does instant queries only,
// hard-codes `device="eno1"` (an interface with no cable, so its rx/tx have read
// zero the whole time) and has no notion of which machine it is asking about.

type VectorResult = {
  status: string;
  error?: string;
  data?: { resultType: string; result: { metric: Record<string, string>; value: [number, string] }[] };
};

type MatrixResult = {
  status: string;
  error?: string;
  data?: { resultType: string; result: { metric: Record<string, string>; values: [number, string][] }[] };
};

export type Sample = { labels: Record<string, string>; value: number };

function num(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/** An instant query, as a list of samples. Empty means the expression matched
 *  nothing, which is a normal answer and not an error -- a sensor the board does
 *  not have, a container that is not running. */
export async function instant(expr: string): Promise<Sample[]> {
  const url = `${config.prometheus}/api/v1/query?query=${encodeURIComponent(expr)}`;
  const body = await getJson<VectorResult>(url);
  if (!body || body.status !== "success") {
    throw new Error(body?.error ?? "prometheus query failed");
  }
  return (body.data?.result ?? []).map((s) => ({ labels: s.metric, value: num(s.value[1]) }));
}

/** The single value of a scalar-shaped expression, or null when there is none.
 *
 *  Null rather than 0, which is the one thing mediarr-dash gets wrong here: a
 *  missing sensor and a sensor reading zero look identical once you coalesce,
 *  and "0 W" on a dashboard is a lie where "—" is the truth. */
export async function scalar(expr: string): Promise<number | null> {
  const rows = await instant(expr);
  const first = rows[0];
  if (!first || !Number.isFinite(first.value)) return null;
  return first.value;
}

/** Instant query keyed by one label, for the per-container and per-sensor
 *  breakdowns. Later keys win, which only matters for expressions that do not
 *  aggregate -- those should not be using this. */
export async function byLabel(expr: string, label: string): Promise<Map<string, number>> {
  const rows = await instant(expr);
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = row.labels[label];
    if (key !== undefined) out.set(key, row.value);
  }
  return out;
}

export type Series = { labels: Record<string, string>; points: [number, number | null][] };

/** A range query. Step is the caller's business: the series registry clamps it
 *  so no request can ask for 172 800 points across 180 days of retention. */
export async function range(expr: string, startS: number, endS: number, stepS: number): Promise<Series[]> {
  const params = new URLSearchParams({
    query: expr,
    start: String(startS),
    end: String(endS),
    step: String(stepS),
  });
  const body = await getJson<MatrixResult>(`${config.prometheus}/api/v1/query_range?${params}`);
  if (!body || body.status !== "success") {
    throw new Error(body?.error ?? "prometheus range query failed");
  }
  return (body.data?.result ?? []).map((s) => ({
    labels: s.metric,
    points: s.values.map(([t, v]) => {
      const n = Number(v);
      return [t, Number.isFinite(n) ? n : null] as [number, number | null];
    }),
  }));
}

type AlertsResult = {
  status: string;
  data?: {
    alerts: {
      labels: Record<string, string>;
      annotations: Record<string, string>;
      state: string;
      activeAt: string;
    }[];
  };
};

/** Firing and pending alerts, straight from Prometheus.
 *
 *  There is no Alertmanager on this box, so these rules fire into nothing and
 *  this is the only place they become visible outside Grafana's rules page.
 *  Read-only on purpose: an acknowledge button whose state lived only in this
 *  process would be worse than no button. */
export async function alerts(): Promise<AlertsResult["data"]> {
  const body = await getJson<AlertsResult>(`${config.prometheus}/api/v1/alerts`);
  if (!body || body.status !== "success") throw new Error("prometheus alerts query failed");
  return body.data;
}
