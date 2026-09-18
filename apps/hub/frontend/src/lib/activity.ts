import { useEffect, useRef, useState } from "react";

/** Refresh, as one thing the whole app does rather than one thing per page.
 *
 *  The refresh button used to re-poll `/api/summary` and nothing else, so on a
 *  metric page it spun for a moment and changed nothing you were looking at.
 *  Pages register what refreshing means for them here; the button runs all of
 *  them and waits for the lot, which is also what tells the indicator when to
 *  stop. */
type Handler = () => Promise<unknown> | unknown;

const handlers = new Set<Handler>();
const listeners = new Set<(busy: boolean) => void>();
let depth = 0;

/** Exactly one sweep of the trace, matched to its CSS duration. A refresh that
 *  resolves in 40 ms off a warm cache would otherwise flash the indicator for
 *  two frames, which reads as a glitch rather than as an answer -- and half a
 *  sweep reads as one that was cut off. */
const MIN_MS = 1200;

function emit(busy: boolean): void {
  for (const listener of listeners) listener(busy);
}

/** Registers what this component does when the user asks for fresh data. The
 *  handler is held in a ref so it can close over current state without
 *  re-registering on every render. */
export function useRefreshHandler(handler: Handler): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const wrapped: Handler = () => ref.current();
    handlers.add(wrapped);
    return () => {
      handlers.delete(wrapped);
    };
  }, []);
}

/** Runs every registered handler and stays busy until they all settle.
 *
 *  `allSettled`, not `all`: one page's failing endpoint should not leave the
 *  indicator spinning forever over the three that answered. */
export async function refreshAll(): Promise<void> {
  const started = Date.now();
  depth += 1;
  if (depth === 1) emit(true);

  try {
    await Promise.allSettled([...handlers].map((h) => h()));
  } finally {
    const remaining = MIN_MS - (Date.now() - started);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    depth = Math.max(0, depth - 1);
    if (depth === 0) emit(false);
  }
}

/** True while a user-asked-for refresh is out.
 *
 *  Deliberately not true during the background poll. The page re-reads itself
 *  every five seconds and an indicator that fired on each of those would be
 *  permanent decoration, which is the same as no indicator at all. */
export function useRefreshing(): boolean {
  const [busy, setBusy] = useState(depth > 0);

  useEffect(() => {
    listeners.add(setBusy);
    setBusy(depth > 0);
    return () => {
      listeners.delete(setBusy);
    };
  }, []);

  return busy;
}
