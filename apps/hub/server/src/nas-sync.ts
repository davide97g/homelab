import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { bytes } from "./format.js";
import type { NasSyncSnapshot } from "./wire.js";

// The switch for nas-sync.sh on the box, which copies newly arrived library
// files to the NAS (hosts/debian/nas-sync). The two sides share one directory,
// ~/ops/xfer-nas/control, bind-mounted here: this process writes `enabled`, the
// script writes everything else and reads `enabled` every two seconds while it
// copies. Nothing else connects them, so the hub needs no SSH and no access to
// the host's systemd.
//
// The script's files are tab-separated lines, replaced whole by rename, so a
// read never sees half of one.

const dir = () => config.nasSyncDir;

async function text(name: string): Promise<string | null> {
  try {
    return await readFile(join(dir(), name), "utf8");
  } catch {
    return null;
  }
}

const rows = (s: string | null | undefined) =>
  (s ?? "")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"));

const count = (s: string | null | undefined) => rows(s).length;

/** The timer runs every 2 minutes; a run that copies holds the lock and keeps
 *  current.tsv fresh instead, so only an idle silence this long means trouble. */
const STALE_MS = 6 * 60_000;

/** The script writes the baseline on its first run, so its presence means both
 *  "installed on the box" and "mounted here". */
export function nasSyncConfigured(): boolean {
  return existsSync(join(dir(), "baseline.txt"));
}

export async function nasSyncSnapshot(): Promise<NasSyncSnapshot> {
  const [enabled, tick, current, queue, recent, baseline, done, nas] = await Promise.all(
    ["enabled", "tick.tsv", "current.tsv", "queue.tsv", "recent.tsv", "baseline.txt", "done.txt", "nas.tsv"].map(text),
  );

  const [tickRow] = rows(tick);
  const lastRun = tickRow ? { at: tickRow[0] ?? "", note: tickRow[1] ?? "" } : null;

  const [cur] = rows(current);
  const currentFile =
    cur && cur.length >= 5
      ? {
          file: cur[0]!,
          phase: cur[1] === "verify" ? ("verify" as const) : ("send" as const),
          bytes: Number(cur[2]) || 0,
          total: Number(cur[3]) || 0,
          startedAt: cur[4]!,
          display: `${bytes(Number(cur[2]) || 0)} of ${bytes(Number(cur[3]) || 0)}`,
        }
      : null;

  const waiting = rows(queue)
    .map(([size, file, state]) => {
      const n = Number(size) || 0;
      return { file: file ?? "", bytes: n, size: bytes(n), settling: state === "settling" };
    })
    .filter((q) => q.file && q.file !== currentFile?.file);

  const [nasRow] = rows(nas);
  const freeKb = nasRow ? Number(nasRow[0]) : NaN;

  const busy = currentFile !== null;
  const stale = !busy && (!lastRun || Date.now() - Date.parse(lastRun.at) > STALE_MS);

  const snapshot: NasSyncSnapshot = {
    configured: baseline != null,
    enabled: (enabled ?? "").trim() === "on",
    lastRun,
    stale: baseline != null && stale,
    current: currentFile,
    queue: waiting,
    queueSize: bytes(waiting.reduce((sum, q) => sum + q.bytes, 0)),
    recent: rows(recent)
      .map(([at, outcome, file, message]) => ({
        at: at ?? "",
        outcome: (["done", "failed", "paused", "full"].includes(outcome ?? "") ? outcome : "failed") as
          NasSyncSnapshot["recent"][number]["outcome"],
        file: file ?? "",
        message: message ?? "",
      }))
      .reverse(),
    baselineCount: count(baseline),
    doneCount: count(done),
    nasFree: Number.isFinite(freeKb) ? bytes(freeKb * 1024) : null,
  };
  if (baseline == null) {
    snapshot.error = `${dir()} has no baseline — nas-sync is not installed on the box, or the directory is not mounted`;
  }
  return snapshot;
}

/** Replaced by rename, never rewritten in place: the script polls this file
 *  while it copies, and an empty read halfway through a write would read as
 *  "off" and stop the copy. The rename is also what nas-sync.path sees. */
export async function setNasSync(on: boolean): Promise<string> {
  const target = join(dir(), "enabled");
  const tmp = `${target}.hub-${process.pid}`;
  await writeFile(tmp, on ? "on\n" : "off\n");
  await rename(tmp, target);
  return on
    ? "NAS sync on: new library files go to the NAS as they arrive"
    : "NAS sync off: any copy in progress stops within seconds and resumes when it is back on";
}
