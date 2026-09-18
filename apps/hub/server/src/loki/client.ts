import { config } from "../config.js";
import { getJson } from "../http.js";

// A thin client over Loki's HTTP API. Nothing here builds a query -- that is
// query.ts's job, and keeping the two apart is what makes it possible to say
// with certainty that no caller-supplied string ever reaches Loki unescaped.

type StreamsResult = {
  status: string;
  data?: {
    resultType: string;
    // Loki merges structured metadata (detected_level among it) into the
    // stream's label set unless the categorize-labels encoding flag is sent, so
    // one map per stream is the whole label picture.
    result: { stream: Record<string, string>; values: [string, string][] }[];
    stats?: { summary?: { totalEntriesReturned?: number } };
  };
};

type ValuesResult = { status: string; data?: string[] };

export type LokiStream = { labels: Record<string, string>; values: [string, string][] };

export async function queryRange(params: {
  query: string;
  startNs: string;
  endNs: string;
  limit: number;
  direction: "forward" | "backward";
}): Promise<LokiStream[]> {
  const search = new URLSearchParams({
    query: params.query,
    start: params.startNs,
    end: params.endNs,
    limit: String(params.limit),
    direction: params.direction,
  });
  const body = await getJson<StreamsResult>(`${config.loki}/loki/api/v1/query_range?${search}`);
  if (!body || body.status !== "success") throw new Error("loki query failed");
  return (body.data?.result ?? []).map((s) => ({ labels: s.stream, values: s.values }));
}

/** The values a label actually has right now. This is what the allow-list is
 *  built from: a caller can only name a container Loki already knows about. */
export async function labelValues(label: string, sinceMs = 6 * 3600_000): Promise<string[]> {
  const search = new URLSearchParams({
    start: String((Date.now() - sinceMs) * 1e6),
    end: String(Date.now() * 1e6),
  });
  const body = await getJson<ValuesResult>(
    `${config.loki}/loki/api/v1/label/${encodeURIComponent(label)}/values?${search}`,
  );
  if (!body || body.status !== "success") throw new Error(`loki label ${label} failed`);
  return body.data ?? [];
}
