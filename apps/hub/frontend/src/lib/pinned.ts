import type { ChartSpec } from "@wire";

// Pinned answers, in localStorage and nowhere else.
//
// The hub stores nothing and collects nothing, and this does not change that: a
// pin is a question and a set of registry ids, held in the browser that asked.
// There is no new server state, nothing to back up, and nothing to leak. The
// cost is that pins do not follow you to another device, which is the right
// trade for a board of charts you can recreate by asking again.

const KEY = "hub.pinned.v1";
const MAX = 12;

export type Pinned = {
  prompt: string;
  spec: ChartSpec;
  at: string;
};

/** Anything unreadable is treated as empty rather than thrown: a pin is not
 *  worth an error boundary, and a stale shape from an older build should quietly
 *  disappear instead of breaking the page that reads it. */
export function pinned(): Pinned[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Pinned =>
        typeof p === "object" && p !== null && "spec" in p && "prompt" in p && "at" in p,
    );
  } catch {
    return [];
  }
}

function write(list: Pinned[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Private mode, or a full quota. Losing a pin is not worth a dialog.
  }
  window.dispatchEvent(new Event("hub:pinned"));
}

export function pin(entry: Pinned): void {
  write([entry, ...pinned().filter((p) => p.prompt !== entry.prompt)]);
}

export function unpin(at: string): void {
  write(pinned().filter((p) => p.at !== at));
}
