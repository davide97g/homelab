import { useCallback, useEffect, useRef, useState } from "react";
import { useRefreshHandler } from "@/lib/activity";
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
 *  one endpoint. Four behaviours are load-bearing and easy to lose:
 *
 *  - the previous payload stays on screen while the next is in flight, because a
 *    dashboard that blanks on every tick is unreadable;
 *  - polling stops while the tab is hidden, so a backgrounded tab is not quietly
 *    hammering Prometheus all day;
 *  - a 401 is `expired`, not an error, so the shell can drop back to the login
 *    card instead of showing a scary message;
 *  - a *new loader* fetches immediately rather than at the next tick. This one
 *    was missing and it is why moving between two pages that share a component
 *    -- any two metric pages -- looked frozen: React keeps the component
 *    mounted, the interval never restarted, and the new panels stayed empty for
 *    up to a minute until a tick that was already scheduled came round. */
export function usePoll<T>(load: (signal: AbortSignal) => Promise<T>, intervalMs: number): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const next = await load(controller.signal);
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
    // `load` is a dependency on purpose: a caller that memoises a new loader has
    // asked a different question, and the effect below restarts on it.
  }, [load]);

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

  // What "refresh" means for this endpoint, for the button in the header. It
  // returns the promise so the indicator can stop when the answer lands rather
  // than after a guessed delay.
  useRefreshHandler(run);

  return { data, error, loading, expired, refreshedAt, refresh: () => void run() };
}
