import type { Torrent, TorrentState } from "./types";

export type Tone = "accent" | "amber" | "danger" | "muted";

/** How each of the 20 states reads: colour, and the word shown to a person. */
const STATES: Record<TorrentState, { tone: Tone; label: string }> = {
  downloading: { tone: "accent", label: "Downloading" },
  forcedDL: { tone: "accent", label: "Downloading" },
  metaDL: { tone: "accent", label: "Fetching metadata" },
  forcedMetaDL: { tone: "accent", label: "Fetching metadata" },
  allocating: { tone: "accent", label: "Allocating" },
  uploading: { tone: "accent", label: "Seeding" },
  forcedUP: { tone: "accent", label: "Seeding" },
  stalledDL: { tone: "amber", label: "Stalled" },
  stalledUP: { tone: "amber", label: "Seeding, idle" },
  queuedDL: { tone: "amber", label: "Queued" },
  queuedUP: { tone: "amber", label: "Queued" },
  checkingDL: { tone: "amber", label: "Checking" },
  checkingUP: { tone: "amber", label: "Checking" },
  checkingResumeData: { tone: "amber", label: "Checking" },
  moving: { tone: "amber", label: "Moving" },
  stoppedDL: { tone: "muted", label: "Stopped" },
  stoppedUP: { tone: "muted", label: "Finished" },
  error: { tone: "danger", label: "Error" },
  missingFiles: { tone: "danger", label: "Files missing" },
  unknown: { tone: "muted", label: "Unknown" },
};

export function describe(state: TorrentState) {
  return STATES[state] ?? { tone: "muted" as Tone, label: state };
}

const STOPPED = new Set<TorrentState>(["stoppedDL", "stoppedUP"]);
const ACTIVE = new Set<TorrentState>([
  "downloading",
  "forcedDL",
  "metaDL",
  "forcedMetaDL",
  "allocating",
  "stalledDL",
  "checkingDL",
  "queuedDL",
]);

export const isStopped = (t: Torrent) => STOPPED.has(t.state);
export const isDownloading = (t: Torrent) => ACTIVE.has(t.state);
export const isComplete = (t: Torrent) => t.progress >= 1;
export const isBroken = (t: Torrent) => t.state === "error" || t.state === "missingFiles";

export const TONE_TEXT: Record<Tone, string> = {
  accent: "text-accent",
  amber: "text-amber",
  danger: "text-danger",
  muted: "text-muted",
};

export const TONE_BG: Record<Tone, string> = {
  accent: "bg-accent",
  amber: "bg-amber",
  danger: "bg-danger",
  muted: "bg-surface-3",
};
