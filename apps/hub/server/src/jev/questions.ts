import type { Range } from "../wire.js";
import type { Question } from "./client.js";

/** What build() needs of a series: its id, its human title, and the sentence
 *  from the registry saying what it answers. Deliberately not `CatalogEntry` --
 *  `asks` is for the model and never goes to the browser. */
export type Askable = { id: string; title: string; asks: string };

// The questions put to Jev, built from the live catalogue rather than a list
// kept in step by hand: adding a series to prom/registry.ts makes it askable
// here with no edit, which is the only reason this stays honest over time.
//
// One call carries all of them. Jev evaluates questions in parallel, so 26
// questions cost about what one costs -- measured at 240-770 ms against this
// catalogue -- and asking in stages would only add round trips.

/** How a candidate series is put to the model, and both halves of this are
 *  load-bearing — they were measured, not guessed.
 *
 *  *The frame.* "The request asks for this metric: X" scores a correct match at
 *  0.24, because it reads as a claim about the user's wording and the user did
 *  not say "temperature band, smoothed". Asking whether X **would answer** the
 *  request scores the same match at 0.94 and the wrong one at 0.03. What a
 *  chart has to settle is sufficiency, not vocabulary.
 *
 *  *The subject.* It is `asks` from the registry rather than `title` and
 *  `description`, because those are written for someone already looking at the
 *  panel. Feeding "Throughput. Transmit is drawn below the axis" to a
 *  sufficiency question scored a plainly correct network request at 0.32 —
 *  below the floor, so it refused. See SeriesDef.asks. */
function sufficiency(entry: Askable): string {
  return `${entry.asks} would answer this request.`;
}

/** Question keys have to be plain identifiers, and series ids carry a dot. The
 *  map is returned rather than the transformation reversed by string surgery,
 *  so an id that one day contains an underscore cannot silently collide. */
export type Built = {
  state: string;
  questions: Record<string, Question>;
  /** question key -> series id */
  index: Record<string, string>;
};

const RANGE_CRITERIA: Record<Range, string> = {
  "15m": "right now, or the last few minutes",
  "1h": "the last hour",
  "6h": "the last several hours, this afternoon, today so far",
  "24h": "the last day, the last 24 hours, yesterday",
  "7d": "the last week, the last seven days",
  "14d": "the last two weeks, the last fortnight, the last 14 days",
  "30d": "the last month, the last 30 days, or no period is stated at all",
};

export const SHAPES = ["timeseries", "table", "stat", "unclear"] as const;
export const MACHINES = ["homelab", "nas", "both"] as const;
export const RANK_BY = ["cpu", "memory"] as const;
export const LIMITS = ["5", "10", "15", "20"] as const;

/** Lowest rung first. Normalised to 0..1 by asScore, and the floor that decides
 *  a refusal is applied to that. */
export const FIT_LADDER = [
  "the request has nothing to do with computers, machines or their metrics",
  "the request is about the machines, but none of the listed metrics really answers it",
  "the request maps directly onto one or more of the listed metrics",
];

export function build(prompt: string, entries: Askable[]): Built {
  const questions: Record<string, Question> = {
    shape: {
      type: "choice",
      criteria: {
        timeseries: "a metric plotted over time, as a chart or graph",
        table: "a ranked list, a top-N, or 'the N most/biggest/busiest' of something",
        stat: "one single current number, with no history",
        unclear: "the request does not ask for any of these",
      },
    },
    machine: {
      type: "choice",
      criteria: {
        homelab:
          "the mini PC, and only it. This is the default machine and the one meant by bare words" +
          " like 'the box', 'the server', 'the machine', 'the mini pc' or 'homelab'",
        nas: "the NAS, and only it. Only when the NAS, the storage box or its drives are named",
        both: "both machines — it compares them, or asks about both, or names neither",
      },
    },
    range: { type: "choice", criteria: { ...RANGE_CRITERIA } },
    threshold: {
      type: "noul",
      instructions:
        "The request asks for a limit, threshold, target or critical reference line to be drawn on the chart.",
    },
    rank_by: {
      type: "choice",
      criteria: {
        cpu: "ranked by CPU, processor, or by 'resource use' / 'most consuming' left unqualified",
        memory: "ranked by memory or RAM specifically",
      },
    },
    limit: {
      type: "choice",
      criteria: {
        "5": "about five rows", "10": "about ten rows, or no count is stated",
        "15": "about fifteen rows", "20": "twenty rows or more",
      },
    },
    fit: { type: "score", criteria: FIT_LADDER },
  };

  const index: Record<string, string> = {};
  entries.forEach((entry, i) => {
    const key = `want_${i}`;
    index[key] = entry.id;
    questions[key] = { type: "noul", instructions: sufficiency(entry) };
  });

  // The catalogue is not in the state: each series is its own question, and a
  // noul weighs its own instructions. Listing them twice only spends tokens.
  const state =
    "Someone is using a dashboard that monitors a small home server setup, and typed the request " +
    "below into it.\n\n" +
    "The setup has two machines: 'homelab', a mini PC that runs Docker containers, and 'nas', a " +
    "network storage box with four drive bays.\n\n" +
    `Request: ${prompt}`;

  return { state, questions, index };
}
