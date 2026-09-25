import { useCallback, useEffect, useRef, useState } from "react";

import { Unauthorized, fetchOverview, type Overview } from "@/lib/api";

type State = {
  data: Overview | null;
  error: string | null;
  loading: boolean;
  /** Set when the session expired, so the app can drop back to the login card. */
  expired: boolean;
  refreshedAt: number | null;
};

/** Polls the overview endpoint and keeps the previous payload on the screen
 *  while the next one is in flight -- a dashboard that blanks on every tick is
 *  unreadable. Polling pauses while the tab is hidden. */
export function useOverview(intervalMs = 5000) {
  const [state, setState] = useState<State>({
    data: null,
    error: null,
    loading: true,
    expired: false,
    refreshedAt: null,
  });
  const inflight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    try {
      const data = await fetchOverview(controller.signal);
      setState({ data, error: null, loading: false, expired: false, refreshedAt: Date.now() });
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof Unauthorized) {
        setState((s) => ({ ...s, loading: false, expired: true }));
        return;
      }
      setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }));
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      void load();
      timer = setInterval(() => void load(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      inflight.current?.abort();
    };
  }, [load, intervalMs]);

  return { ...state, refresh: load };
}
