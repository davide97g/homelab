import type { Range, SeriesFrame } from "@wire";
import { useCallback, useMemo } from "react";
import { usePoll } from "@/hooks/use-poll";
import { fetchSeries } from "@/lib/api";

/** Poll cadence by range. There is no point asking every ten seconds for a
 *  window whose step is an hour, and a 30 day view is something you look at
 *  rather than watch. */
const INTERVALS: Record<Range, number> = {
  "15m": 10_000,
  "1h": 10_000,
  "6h": 30_000,
  "24h": 60_000,
  "7d": 300_000,
  "30d": 600_000,
};

/** One request per page tick carrying every panel's ids, not one request per
 *  panel: fourteen panels polling individually would be ~3 req/s at Prometheus
 *  from a single tab. */
export function useSeries(ids: string[], range: Range, instance: "homelab" | "nas") {
  const key = ids.join(",");
  const load = useCallback(
    (signal: AbortSignal) => fetchSeries(key.split(","), range, instance, signal),
    [key, range, instance],
  );

  const polled = usePoll(load, INTERVALS[range]);

  const byId = useMemo(() => {
    const map = new Map<string, SeriesFrame>();
    for (const frame of polled.data?.frames ?? []) map.set(frame.id, frame);
    return map;
  }, [polled.data]);

  return { ...polled, frame: (id: string) => byId.get(id) ?? null };
}
