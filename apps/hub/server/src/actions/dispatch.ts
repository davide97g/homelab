import { limited } from "../limiter.js";
import type { ActionResult, AuditEntry } from "../wire.js";
import { record } from "./audit.js";
import { Denied } from "./denied.js";
import { ACTIONS } from "./registry.js";

// One dispatcher, not twelve routes.
//
// Auth, throttle, confirmation, idempotency, audit and error shaping all happen
// here, once. Split across a route per action they would happen eleven times and
// then not the twelfth, and the twelfth is always the one that matters.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;

/** Client-generated idempotency keys, held for five minutes.
 *
 *  One mechanism covers three different problems that all look the same from
 *  here: a double-click, a Cloudflare retry of a request whose response was
 *  lost, and a caller retrying after its own timeout while the first call is
 *  still running upstream. A Docker restart is roughly idempotent anyway, but
 *  `radarr.search-missing` and `dokploy.redeploy` are not -- a second call
 *  queues a second search and a second deploy -- and those are the ones this
 *  exists for.
 *
 *  The entry is the *promise*, not the result, so a key that arrives while the
 *  first call is still in flight waits for that call rather than starting a
 *  second one. */
const KEY_TTL_MS = 5 * 60_000;
const inflight = new Map<string, { at: number; result: Promise<ActionResult> }>();

function sweep(): void {
  const now = Date.now();
  for (const [key, entry] of inflight) {
    if (now - entry.at > KEY_TTL_MS) inflight.delete(key);
  }
}

export type DispatchInput = {
  action: unknown;
  target?: unknown;
  key?: unknown;
  confirm?: unknown;
  from: string;
};

function refusal(action: string, target: string | undefined, message: string, from: string): Promise<ActionResult> {
  return finish({ action, target, outcome: "denied", message, from });
}

/** Every attempt is written down, including the refused ones. "Nothing happened"
 *  and "something tried and was stopped" look identical from the outside, and
 *  only one of them is worth knowing about later. */
async function finish(input: {
  action: string;
  target: string | undefined;
  outcome: AuditEntry["outcome"];
  message: string;
  from: string;
}): Promise<ActionResult> {
  const at = new Date().toISOString();
  const entry: AuditEntry = {
    at,
    action: input.action,
    outcome: input.outcome,
    message: input.message,
    from: input.from,
  };
  if (input.target) entry.target = input.target;
  await record(entry);

  const result: ActionResult = {
    ok: input.outcome === "ok" || input.outcome === "deduped",
    action: input.action,
    outcome: input.outcome,
    message: input.message,
    at,
  };
  if (input.target) result.target = input.target;
  return result;
}

export async function dispatch(input: DispatchInput): Promise<ActionResult> {
  const action = typeof input.action === "string" ? input.action : "";
  const target = typeof input.target === "string" && input.target ? input.target : undefined;
  const key = typeof input.key === "string" && /^[A-Za-z0-9_:-]{8,80}$/.test(input.key) ? input.key : null;
  const confirmed = input.confirm === true;

  const def = ACTIONS[action];
  if (!def) return refusal(action || "(none)", target, "no such action", input.from);

  // Throttle before anything else touches a service. The limit is per address
  // and generous for a person, nowhere near enough for a loop.
  if (limited(`action:${input.from}`, MAX_PER_WINDOW, WINDOW_MS)) {
    return finish({ action, target, outcome: "denied", message: "too many actions in a minute", from: input.from });
  }

  const availability = def.available();
  if (!availability.ok) {
    return refusal(action, target, availability.why, input.from);
  }

  if (def.confirm && !confirmed) {
    return refusal(action, target, "this action needs an explicit confirmation", input.from);
  }

  if (def.target !== "none" && !target) {
    return refusal(action, target, "no target given", input.from);
  }

  if (!key) {
    // Not a nicety: without a key there is no way to tell a retry from a second
    // request, and for the replayable actions that difference is a second
    // deploy.
    return refusal(action, target, "a valid idempotency key is required", input.from);
  }

  sweep();
  const seen = inflight.get(key);
  if (seen) {
    const earlier = await seen.result;
    // Deliberately not re-run: the caller gets what the first call decided, and
    // the replay is written down as its own line so the audit shows both.
    return finish({
      action,
      target,
      outcome: "deduped",
      message: `already handled: ${earlier.message}`,
      from: input.from,
    });
  }

  const running = (async (): Promise<ActionResult> => {
    try {
      const message = await def.run(target ?? "");
      return await finish({ action, target, outcome: "ok", message, from: input.from });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Denied means nothing was attempted -- a deny-listed container, a target
      // that does not resolve, an id off the allow-list. Recording that as
      // "failed" would send someone to look at a service that is perfectly fine.
      const outcome = err instanceof Denied ? "denied" : "failed";
      return await finish({ action, target, outcome, message, from: input.from });
    }
  })();

  inflight.set(key, { at: Date.now(), result: running });
  return running;
}
