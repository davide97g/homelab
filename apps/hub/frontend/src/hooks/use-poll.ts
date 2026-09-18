import { useCallback, useEffect, useRef, useState } from "react";
import { Unauthorized } from "@/lib/api";

export type Polled<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  expired: boolean;
  refreshedAt: number | null;
  refresh: () => void;
};

/** Generalised from mediarr-dash's use-overview.ts, which does exactly this for
 *  one endpoint. Three behaviours are load-bearing and easy to lose:
 *
 *  - the previous payload stays on screen while the next is in flight, because a
 *    dashboard that blanks on every tick is unreadable;
 *  - polling stops while the tab is hidden, so a backgrounded tab is not quietly
 *    hammering Prometheus all day;
 *  - a 401 is `expired`, not an error, so the shell can drop back to the login
 *    card instead of showing a scary message. */
export function usePoll<T>(load: (signal: AbortSignal) => Promise<T>, intervalMs: number): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const next = await loadRef.current(controller.signal);
      if (controller.signal.aborted) return;
      setData(next);
      setError(null);
      setRefreshedAt(Date.now());
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof Unauthorized) setExpired(true);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const start = () => {
      if (timer.current) return;
      void run();
      timer.current = setInterval(() => void run(), intervalMs);
    };
    const stop = () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      abort.current?.abort();
    };
  }, [run, intervalMs]);

  return { data, error, loading, expired, refreshedAt, refresh: () => void run() };
}
