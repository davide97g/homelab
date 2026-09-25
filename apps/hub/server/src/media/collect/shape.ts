import type { MediaActivity, MediaNode, Tone } from "../../wire.js";

// The shared shape of a pipeline collector, and the two failure shapes every one
// of them needs.
//
// Ported from mediarr-dash's services/types.ts, with one change that is the
// whole reason this is not a copy: a collector returns its numbers as well as
// its card. mediarr-dash decides which edges are busy in the *browser*, by
// finding a stat by its English label and parsing the digits back out of its
// display string — so renaming "Queue" to "Queued" would silently stop an arrow
// animating. Here each collector hands up a small map of raw numbers and
// pipeline.ts reads those, so the label is free to say whatever reads best.

/** Raw numbers a collector wants the pipeline to reason about. Never rendered. */
export type Flow = Record<string, number>;

/** Everything about a node except where it sits and what it costs the box —
 *  neither of which a collector knows or should. */
export type ServiceSnapshot = Omit<MediaNode, "position" | "load" | "kind">;

export type Collected = { node: ServiceSnapshot; flow: Flow };

/** A key that has never been collected on the box. Distinct from `down` on
 *  purpose: nothing is broken, the hub has simply never been told how to ask. */
export function unconfigured(
  id: string,
  label: string,
  role: string,
  link: string,
  envKey: string,
): Collected {
  return {
    node: {
      id,
      label,
      role,
      link,
      status: "unconfigured",
      error: `${envKey} has not been collected on the box — run scripts/collect-env.sh`,
      latencyMs: null,
      stats: [],
      flags: [],
      activity: [],
      activityLabel: "Activity",
    },
    flow: {},
  };
}

/** It did not answer. */
export function down(id: string, label: string, role: string, link: string, err: unknown): Collected {
  return {
    node: {
      id,
      label,
      role,
      link,
      status: "down",
      error: err instanceof Error ? err.message : String(err),
      latencyMs: null,
      stats: [],
      flags: [],
      activity: [],
      activityLabel: "Activity",
    },
    flow: {},
  };
}

/** The *arr apps and Bazarr all report a list of things wrong with themselves.
 *  One line of it belongs on the card; the tone is the difference between an
 *  error (worth a degraded node) and a warning (an indexer that failed once, an
 *  update available), which is why the two are never summed. */
export function healthValue(errors: number, warnings: number): { value: string; tone: Tone } {
  if (errors > 0) return { value: `${errors} error${errors > 1 ? "s" : ""}`, tone: "bad" };
  if (warnings > 0) return { value: `${warnings} warning${warnings > 1 ? "s" : ""}`, tone: "warn" };
  return { value: "clean", tone: "good" };
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Newest first, capped. A drawer is read, not audited: 25 rows is already more
 *  than anyone scrolls, and the payload is polled every five seconds. */
export function cap(rows: MediaActivity[]): MediaActivity[] {
  return rows.slice(0, 25);
}
