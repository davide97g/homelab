import { Cache } from "../cache.js";
import { config } from "../config.js";
import { SERIES } from "../prom/registry.js";
import type { AskResponse, AskThreshold, AskUnderstood, ChartSpec, Range, Unit } from "../wire.js";
import { asChoice, asNoul, asScore, decide } from "./client.js";
import { FIT_LADDER, LIMITS, MACHINES, RANK_BY, SHAPES, build } from "./questions.js";

// Prompt in, ChartSpec out. The whole of the feature's judgement lives here.
//
// The division of labour, which is the thing to hold on to when reading this:
//
//   numbers come from the text,  semantics come from the model.
//
// "50", "2 weeks" and "10" are pulled out of the prompt by the regexes below
// before Jev is called. Jev is never asked what the threshold *is* -- only
// whether the request wants one, which of the seven ranges it means, and which
// series would answer it. A model that emits no tokens cannot invent a limit
// that nobody typed, and this file is careful never to give it the chance.
//
// Everything Jev picks is then checked against prom/registry.ts anyway, the
// same way parseRequest checks the browser. The model narrows a list it did not
// write; it cannot add to it.

const cache = new Cache(60_000);

/** Below this, the request did not map onto the catalogue and the honest answer
 *  is to say so. Measured: a temperature question scores 0.99, "what is the
 *  weather in rome tomorrow" scores 0.00. */
const FIT_FLOOR = 0.45;

/** Per-series floor. Correct matches land at 0.57-0.94 and wrong ones at 0.03,
 *  so the gap is wide; the floor sits below the matches rather than midway,
 *  because a near-duplicate pair (temp.band against temp.sensors) splits the
 *  mass between them and both readings are legitimate. */
const WANT_FLOOR = 0.5;

/** Four panels is the most an answer can usefully be. */
const MAX_IDS = 4;

const MAX_PROMPT = 400;

// ——— What the text itself says ———————————————————————————————————————————————

const DURATIONS: { re: RegExp; seconds: number }[] = [
  { re: /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i, seconds: 60 },
  { re: /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i, seconds: 3600 },
  { re: /(\d+(?:\.\d+)?)\s*(?:days?|d)\b/i, seconds: 86_400 },
  { re: /(\d+(?:\.\d+)?)\s*(?:weeks?|wks?|w)\b/i, seconds: 604_800 },
  { re: /(\d+(?:\.\d+)?)\s*(?:months?|mo)\b/i, seconds: 2_592_000 },
];

const RANGE_SECONDS: Record<Range, number> = {
  "15m": 900, "1h": 3600, "6h": 21_600, "24h": 86_400,
  "7d": 604_800, "14d": 1_209_600, "30d": 2_592_000,
};

/** An explicit duration in the text beats the model's guess, because "2 weeks"
 *  is not a judgement call. Snapped to the nearest range the registry actually
 *  serves, on a log scale -- 10 days is nearer 7d than 30d to a reader, and
 *  linearly it is not. */
export function durationFromText(prompt: string): Range | null {
  for (const { re, seconds } of DURATIONS) {
    const m = re.exec(prompt);
    if (!m?.[1]) continue;
    const want = Number(m[1]) * seconds;
    if (!Number.isFinite(want) || want <= 0) continue;
    let best: Range = "6h";
    let bestErr = Infinity;
    for (const [range, s] of Object.entries(RANGE_SECONDS) as [Range, number][]) {
      const err = Math.abs(Math.log(s / want));
      if (err < bestErr) { bestErr = err; best = range; }
    }
    return best;
  }
  return null;
}

/** The number a threshold line is drawn at, and the unit it is in.
 *
 *  Only fires on a comparison word, so "the last 2 weeks" and "10 services" do
 *  not become thresholds. The unit is taken from the symbol when the text
 *  carries one and left to the series otherwise. */
const THRESHOLD_RE =
  /(?:over|above|under|below|exceeds?|more than|less than|at|of|threshold|limit|line)\s*(\d+(?:\.\d+)?)\s*(°\s*c?|celsius|degrees?|%|percent|w\b|watts?|gb\b|mb\b|tb\b)?/i;

const UNIT_WORDS: { re: RegExp; unit: Unit }[] = [
  { re: /^(°|celsius|degree)/i, unit: "celsius" },
  { re: /^(%|percent)/i, unit: "percent" },
  { re: /^(w\b|watt)/i, unit: "watts" },
  { re: /^(gb|mb|tb)\b/i, unit: "bytes" },
];

const BYTE_SCALE: Record<string, number> = { mb: 1e6, gb: 1e9, tb: 1e12 };

export function thresholdFromText(prompt: string): { value: number; unit: Unit | null } | null {
  const m = THRESHOLD_RE.exec(prompt);
  if (!m?.[1]) return null;
  let value = Number(m[1]);
  if (!Number.isFinite(value)) return null;

  const raw = (m[2] ?? "").trim().toLowerCase();
  let unit: Unit | null = null;
  for (const { re, unit: u } of UNIT_WORDS) {
    if (re.test(raw)) { unit = u; break; }
  }
  const scale = BYTE_SCALE[raw.replace(/\s/g, "")];
  if (scale) value *= scale;
  return { value, unit };
}

/** "top 10", "10 most", "first 5". Distinct from the threshold regex on
 *  purpose: a count sits next to a superlative, a threshold next to a
 *  comparison. */
const COUNT_RE = /(?:top|first|list of|show me)\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:most|busiest|biggest|largest|heaviest)/i;

export function countFromText(prompt: string): number | null {
  const m = COUNT_RE.exec(prompt);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(50, Math.round(n)) : null;
}

// ——— The call ————————————————————————————————————————————————————————————————

function unitLabel(value: number, unit: Unit): string {
  switch (unit) {
    case "celsius": return `${value} °C`;
    case "percent": return `${value}%`;
    case "watts": return `${value} W`;
    case "bytes": return value >= 1e9 ? `${value / 1e9} GB` : `${value / 1e6} MB`;
    default: return String(value);
  }
}

async function run(prompt: string): Promise<AskResponse> {
  // Straight from the registry, not from catalog(): `asks` is written for the
  // model and has no business in a browser payload.
  const entries = Object.entries(SERIES).map(([id, def]) => ({
    id,
    title: def.title,
    asks: def.asks,
  }));
  const { state, questions, index } = build(prompt, entries);

  const startedAt = Date.now();
  const res = await decide(state, questions);
  const tookMs = Date.now() - startedAt;
  const a = res.answers;

  const fit = asScore(a.fit, FIT_LADDER.length) ?? 0;
  const shape = asChoice(a.shape, SHAPES) ?? "unclear";
  const instance = (asChoice(a.machine, MACHINES) ?? "both") as ChartSpec["instance"];
  // The text wins where the text is explicit; the model fills the silence.
  const range = durationFromText(prompt) ?? ((asChoice(a.range, Object.keys(RANGE_SECONDS)) ?? "6h") as Range);

  // Every candidate, scored, best first -- including the ones that did not
  // clear, because those are what a refusal offers as chips.
  const byTitle = new Map(entries.map((e) => [e.id, e.title]));
  const candidates = Object.entries(index)
    .map(([key, id]) => ({ id, title: byTitle.get(id) ?? id, score: asNoul(a[key]) ?? 0 }))
    .sort((x, y) => y.score - x.score);

  const wantsThreshold = (asNoul(a.threshold) ?? 0) > 0.5;
  const found = wantsThreshold ? thresholdFromText(prompt) : null;

  const understood: AskUnderstood = {
    range, instance, shape, fit,
    candidates: candidates.slice(0, 6),
  };

  const base = {
    at: new Date().toISOString(),
    prompt,
    understood,
    tookMs,
  };

  // Ids the registry knows, that clear the floor, capped. `id in SERIES` is the
  // same check parseRequest makes of the browser, applied to the model for the
  // same reason.
  const ids = candidates
    .filter((c) => c.score >= WANT_FLOOR && c.id in SERIES)
    .slice(0, MAX_IDS)
    .map((c) => c.id);

  const explore = `${config.links.grafana}/explore`;

  if (fit < FIT_FLOOR) {
    // No chips on this path. The candidates exist -- every noul was answered --
    // but offering "Min / avg / max, smoothed" to someone who asked about the
    // weather in Rome is not a suggestion, it is the highest of twenty numbers
    // that are all noise. Nothing here is near, so nothing is offered.
    understood.candidates = [];
    return { ...base, reason: "That does not look like a question about these two machines.", grafana: explore };
  }
  if (shape === "unclear") {
    return { ...base, reason: "I could not tell whether you wanted a chart, a list or a single number.", grafana: explore };
  }

  if (shape === "table") {
    const spec: ChartSpec = {
      shape: "table",
      ids: [],
      range,
      instance,
      rankBy: (asChoice(a.rank_by, RANK_BY) ?? "cpu") as "cpu" | "memory",
      limit: countFromText(prompt) ?? Number(asChoice(a.limit, LIMITS) ?? "10"),
    };
    return { ...base, spec };
  }

  if (ids.length === 0) {
    return {
      ...base,
      reason: "Nothing collected here answers that. The nearest things are below.",
      grafana: explore,
    };
  }

  const spec: ChartSpec = { shape: "chart", ids, range, instance };

  // The unit follows the leading series when the text did not say one, so
  // "over 50" on a temperature chart is 50 °C and not a bare number.
  if (found) {
    const unit = found.unit ?? SERIES[ids[0]!]?.unit ?? "count";
    const threshold: AskThreshold = {
      value: found.value,
      unit,
      label: unitLabel(found.value, unit),
    };
    spec.threshold = threshold;
    understood.threshold = threshold;
  }

  return { ...base, spec };
}

/** Cached on the exact prompt for a minute: it collapses a double submit, and a
 *  repeated question costs nothing. Single-flight comes free with Cache, so two
 *  tabs asking at once are one call to a paid API. */
export function ask(prompt: string): Promise<AskResponse> {
  return cache.get(`ask:${prompt}`, () => run(prompt));
}

/** Rejects before anything is spent. The prompt is the only free-form string
 *  the hub has ever accepted, so it is length-capped here and never used to
 *  build anything but a JSON body. */
export function parsePrompt(raw: unknown): string | { error: string } {
  if (typeof raw !== "string") return { error: "no prompt given" };
  const prompt = raw.trim().replace(/\s+/g, " ");
  if (!prompt) return { error: "no prompt given" };
  if (prompt.length > MAX_PROMPT) return { error: `prompt is too long (max ${MAX_PROMPT} characters)` };
  return prompt;
}
