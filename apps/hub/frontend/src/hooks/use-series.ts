import type { Range, SeriesFrame } from "@wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRefreshHandler } from "@/lib/activity";
import { fetchSeries, streamSeries, Unauthorized } from "@/lib/api";

export type Instance = "homelab" | "nas";

/** Poll cadence by range. There is no point asking every ten seconds for a
 *  window whose step is an hour, and a 30 day view is something you look at
 *  rather than watch. */
const INTERVALS: Record<Range, number> = {
  "15m": 10_000,
  "1h": 10_000,
  "6h": 30_000,
  "24h": 60_000,
  "7d": 300_000,
  "14d": 600_000,
  "30d": 600_000,
};

export type SeriesState = {
  frame: (id: string) => SeriesFrame | null;
  /** Ids still waiting on their first answer, so a panel knows whether it is
   *  empty because nothing was found or because nothing has arrived yet. */
  pending: Set<string>;
  /** When this window started loading, for the elapsed counter a slow first
   *  paint shows. Null once everything has landed. */
  startedAt: number | null;
  error: string | null;
  expired: boolean;
  refreshedAt: number | null;
};

const EMPTY: Set<string> = new Set();

/** Frames for one machine, filled in as they arrive and then kept fresh.
 *
 *  Two phases, because they want opposite things. The *first* paint of a window
 *  is slow and uneven: every panel is a cold Prometheus range query, the NAS is
 *  a minute-resolution scrape reached over a tunnel, and waiting for the slowest
 *  one before drawing any of them is how six charts end up as six grey boxes for
 *  half a minute. So it streams, and each panel appears as it resolves.
 *
 *  After that the server has them all cached and the cheap thing is what was
 *  here before: one batched request per tick carrying every id, rather than one
 *  request per panel. */
export function useSeries(ids: string[], range: Range, instance: Instance, enabled = true): SeriesState {
  const key = `${ids.join(",")}|${range}|${instance}|${enabled}`;
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const [frames, setFrames] = useState<Map<string, SeriesFrame>>(new Map());
  const [pending, setPending] = useState<Set<string>>(EMPTY);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const pollRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (!enabled) {
      setFrames(new Map());
      setPending(EMPTY);
      setStartedAt(null);
      return;
    }

    const wanted = idsRef.current;
    let live = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    let abort: AbortController | null = null;

    // A different window is a different question. Holding the previous answer on
    // screen while this one loads would be showing six hours of the mini PC
    // labelled as fifteen minutes of the NAS.
    setFrames(new Map());
    setPending(new Set(wanted));
    setStartedAt(Date.now());
    setError(null);

    const poll = async () => {
      if (document.hidden) return;
      abort?.abort();
      const controller = new AbortController();
      abort = controller;
      try {
        const res = await fetchSeries(wanted, range, instance, controller.signal);
        if (!live || controller.signal.aborted) return;
        setFrames(new Map(res.frames.map((f) => [f.id, f])));
        setRefreshedAt(Date.now());
        setError(null);
      } catch (err) {
        if (!live || controller.signal.aborted) return;
        if (err instanceof Unauthorized) setExpired(true);
        else setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (live && !controller.signal.aborted) {
          setPending(EMPTY);
          setStartedAt(null);
        }
      }
    };

    pollRef.current = poll;

    const startPolling = () => {
      timer ??= setInterval(() => void poll(), INTERVALS[range]);
    };

    const closeStream = streamSeries(wanted, range, instance, {
      onFrame: (frame) => {
        if (!live) return;
        setFrames((prev) => new Map(prev).set(frame.id, frame));
        setPending((prev) => {
          if (!prev.has(frame.id)) return prev;
          const next = new Set(prev);
          next.delete(frame.id);
          return next;
        });
        setRefreshedAt(Date.now());
      },
      onDone: () => {
        if (!live) return;
        setPending(EMPTY);
        setStartedAt(null);
        startPolling();
      },
      onError: () => {
        if (!live) return;
        // Not shown to anyone. The batched route answers the same question, just
        // all at once, so the page falls back to it and carries on.
        void poll();
        startPolling();
      },
    });

    // A hidden tab has no reason to keep asking Prometheus for charts nobody is
    // looking at; coming back should not wait a whole interval for a number.
    const onVisibility = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      live = false;
      closeStream();
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearInterval(timer);
      abort?.abort();
    };
    // `key` carries ids, range, instance and enabled. Listing them instead would
    // re-run on every render, because `ids` is a fresh array each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The frames are already drawn, so a refresh re-reads them through the
  // batched route rather than opening a new stream: re-streaming would mean
  // blanking six charts to fill them back in one at a time, which is the right
  // trade on a cold window and the wrong one here.
  useRefreshHandler(useCallback(() => (enabled ? pollRef.current() : undefined), [enabled]));

  return {
    frame: (id: string) => frames.get(id) ?? null,
    pending,
    startedAt,
    error,
    expired,
    refreshedAt,
  };
}
