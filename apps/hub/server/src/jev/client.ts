import { config } from "../config.js";
import { ServiceError, getJson } from "../http.js";

// The HTTP surface of TypeSafe's Jev, and nothing else.
//
// The split is the one loki/client.ts draws and for the same reason: this file
// speaks the protocol, ask.ts decides what to say. Keeping them apart is what
// makes it possible to state plainly that nothing Jev answers is ever executed
// -- the answers come back as probabilities and a label from a list this
// process wrote, and the validator downstream checks them against the registry
// anyway.
//
// Jev is a "System One" model: it does not generate text. You hand it a `state`
// and a set of typed `questions`, and it answers all of them in parallel with
// calibrated probabilities. Adding questions barely moves the latency, which is
// why ask.ts asks everything at once rather than in stages.

/** Yes/no. The answer *is* the probability -- there is no separate confidence. */
export type NoulQuestion = { type: "noul"; instructions: string };

/** Pick one label. `criteria` maps each option to the case for choosing it, and
 *  the options are exactly its keys -- there is no separate options array. */
export type ChoiceQuestion = { type: "choice"; criteria: Record<string, string> };

/** Rate against ordered levels. `criteria` is the ladder, lowest first, and the
 *  answer comes back as a position on it. */
export type ScoreQuestion = { type: "score"; criteria: string[] };

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type ScoreAnswer = {
  type: "score";
  /** A position on the ladder, fractional -- 1.88 on a three-rung ladder is
   *  "nearly the top rung". Divide by `criteria.length - 1` for a 0..1 reading. */
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
};
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type JevResponse = {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
};

export function jevConfigured(): boolean {
  return Boolean(config.jev.key);
}

export async function decide(
  state: string,
  questions: Record<string, Question>,
): Promise<JevResponse> {
  if (!config.jev.key) throw new ServiceError("JEV_API_KEY has not been collected on the box");

  // The first Authorization: Bearer in this codebase, and the first call with a
  // timeout set for a service that is not on the LAN -- the 6 s default would
  // fail a cold connection over the public internet rather than a slow model.
  return getJson<JevResponse>(`${config.jev.url}/v1/systemone`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.jev.key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "jev-latest", state, questions }),
    timeoutMs: config.jev.timeoutMs,
  });
}

/** Narrowing helpers. The API is schema-strict and never returns a type it was
 *  not asked for, but this process does not get to assume that about anything
 *  that arrived over a socket. */
export function asNoul(a: Answer | undefined): number | null {
  return a && a.type === "noul" && typeof a.noul === "number" ? a.noul : null;
}

export function asChoice(a: Answer | undefined, allowed: readonly string[]): string | null {
  if (!a || a.type !== "choice" || typeof a.choice !== "string") return null;
  return allowed.includes(a.choice) ? a.choice : null;
}

/** Returns the score normalised to 0..1 against the ladder it was asked on. */
export function asScore(a: Answer | undefined, rungs: number): number | null {
  if (!a || a.type !== "score" || typeof a.score !== "number") return null;
  if (rungs < 2) return null;
  return Math.max(0, Math.min(1, a.score / (rungs - 1)));
}
