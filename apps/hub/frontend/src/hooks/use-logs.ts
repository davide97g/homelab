import type { LogLevel, LogLine, LogRange, LogsResponse } from "@wire";
import { useEffect, useRef, useState } from "react";
import { fetchLogs, Unauthorized } from "@/lib/api";

export type LogFilters = {
  range: LogRange;
  host: string | null;
  container: string | null;
  unit: string | null;
  levels: LogLevel[];
  contains: string;
};

/** How many lines the pane will hold before dropping the oldest. A tail left
 *  running all afternoon must not grow without bound. */
const MAX_LINES = 2000;
const WINDOW_LIMIT = 500;
const TAIL_LIMIT = 500;
const TAIL_MS = 5000;

/** Live tail as a 5 s poll with a cursor, not a WebSocket.
 *
 *  Loki's `/tail` is a WebSocket, and bridging it means an SSE endpoint on the
 *  server plus reconnect plus backpressure — for a pane that is looked at for
 *  thirty seconds at a time. A poll carrying `since` costs one request per five
 *  seconds and cannot fall behind: the cursor is a nanosecond timestamp, so the
 *  next call asks for exactly what arrived after the last line on screen. */
export function useLogs(filters: LogFilters, live: boolean) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [meta, setMeta] = useState<Pick<LogsResponse, "query" | "grafana" | "truncated"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);

  const cursor = useRef<string | null>(null);
  const key = JSON.stringify(filters);

  // A filter change is a new window, not more of the old one, so the cursor and
  // the pane are both reset.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    cursor.current = null;

    fetchLogs({ ...filters, limit: WINDOW_LIMIT }, controller.signal)
      .then((res) => {
        setLines(res.lines);
        // With no lines at all there is no cursor to tail from, so start the
        // tail at "now" rather than re-reading the whole window every five
        // seconds and re-rendering the same nothing.
        cursor.current = res.cursor ?? String(BigInt(Date.now()) * 1_000_000n);
        setMeta(res);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof Unauthorized) setExpired(true);
        else setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!live) return;
    let stopped = false;

    const timer = setInterval(async () => {
      // A hidden tab keeps its interval; there is no reason for it to keep
      // asking Loki for lines nobody is looking at.
      if (document.hidden || !cursor.current) return;
      try {
        const res = await fetchLogs({ ...filters, limit: TAIL_LIMIT, since: cursor.current });
        if (stopped) return;
        cursor.current = res.cursor ?? cursor.current;
        if (res.lines.length > 0) {
          setLines((prev) => [...prev, ...res.lines].slice(-MAX_LINES));
        }
        setError(null);
      } catch (err) {
        if (stopped) return;
        if (err instanceof Unauthorized) setExpired(true);
        // A single failed tick is not worth clearing the pane over; the next one
        // usually works and the cursor has not moved.
      }
    }, TAIL_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, key]);

  return { lines, meta, error, loading, expired };
}
