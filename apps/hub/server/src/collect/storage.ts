import { Cache } from "../cache.js";
import { bytes, display } from "../format.js";
import { soft } from "../http.js";
import { byLabel, instant, scalar } from "../prom/client.js";
import { PSEUDO_FS } from "../prom/registry.js";
import type { Filesystem, Health, StorageHost, StorageMount, StorageSummary, StorageTrend } from "../wire.js";
import { HOSTS } from "./host.js";

// How full both machines are, as one instant answer.
//
// The storage page already had six time series on it and still could not say
// how much space there is. A line at 77% tells you the ratio and nothing about
// whether that is 300 GB or 3 TB free, and the NAS's line is the interesting
// one precisely because its capacity is twenty times the mini PC's.
//
// Two things this is careful about:
//
//   A filesystem mounted twice is one filesystem. UGOS bind-mounts the pool at
//   /home, so summing every mountpoint would report the NAS as twice its size
//   and half as full. Mounts are grouped by device and only the primary path is
//   counted; the others travel along as aliases so the page can say so.
//
//   A missing sample is not an empty disk. Everything here is nullable and the
//   page renders "not reporting" rather than a zero -- the NAS is scraped over a
//   tailnet hop and is the machine most likely to be absent.

const cache = new Cache(10_000);

/** A week, because the question is "is this filling" and a day of samples on a
 *  media pool is one download. `deriv` fits a line over whatever is in the
 *  window, so a filesystem younger than that is still answered -- and one with a
 *  single sample gets no answer at all, which is the correct one. */
const TREND_WINDOW = "7d";

/** Below this, a slope is the fit finding noise rather than a filesystem going
 *  anywhere, and projecting it to a date would invent a deadline. */
const NOISE_FLOOR_PER_DAY = 16 * 1024 ** 2;

const DAY_S = 86400;

function fsHealth(percent: number | null): Health {
  if (percent === null) return "unknown";
  if (percent >= 90) return "bad";
  if (percent >= 80) return "warn";
  return "ok";
}

export function filesystem(
  mountpoint: string,
  device: string,
  fstype: string,
  size: number | null,
  avail: number | null,
): Filesystem {
  const used = size !== null && avail !== null ? size - avail : null;
  const percent = size !== null && avail !== null && size > 0 ? 100 * (1 - avail / size) : null;
  return {
    mountpoint,
    device,
    fstype,
    sizeBytes: size,
    usedBytes: used,
    availBytes: avail,
    percent,
    sizeDisplay: display(size, "bytes"),
    usedDisplay: display(used, "bytes"),
    availDisplay: display(avail, "bytes"),
  };
}

/** How far back the recap will reach for a machine that is not answering now.
 *  A week, because the NAS has been off the tailnet for longer than a day
 *  before and a card saying "8.0 TB, 55% full, as of yesterday" is worth more
 *  than an empty one. The age is always printed next to the numbers. */
const STALE_LOOKBACK = "7d";

/** Every real filesystem on a machine, largest first. Shared with the NAS page,
 *  which asks the same question about one machine.
 *
 *  `at` wraps the expression when the caller wants the last known sample rather
 *  than the current one -- same series, same labels, so nothing downstream has
 *  to know which of the two it got. */
export async function collectFilesystems(instance: string, lookback?: string): Promise<Filesystem[]> {
  const at = (metric: string) => {
    const selector = `${metric}{instance="${instance}",fstype!~"${PSEUDO_FS}"}`;
    return lookback ? `last_over_time(${selector}[${lookback}])` : selector;
  };

  const [sizes, avails] = await Promise.all([
    instant(at("node_filesystem_size_bytes")),
    instant(at("node_filesystem_avail_bytes")),
  ]);

  const availByMount = new Map(avails.map((r) => [r.labels.mountpoint ?? "", r.value]));

  return sizes
    .map((r) =>
      filesystem(
        r.labels.mountpoint ?? "?",
        r.labels.device ?? "?",
        r.labels.fstype ?? "?",
        Number.isFinite(r.value) ? r.value : null,
        availByMount.get(r.labels.mountpoint ?? "") ?? null,
      ),
    )
    .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
}

/** The change in *used* bytes per day, by mountpoint. `deriv` on available bytes
 *  is negated rather than fitted on used bytes directly, because node_exporter
 *  exports avail and size, not used, and size is the constant of the two. */
async function collectTrends(instance: string): Promise<Map<string, number>> {
  const slopes = await byLabel(
    `deriv(node_filesystem_avail_bytes{instance="${instance}",fstype!~"${PSEUDO_FS}"}[${TREND_WINDOW}])`,
    "mountpoint",
  );
  return new Map(Array.from(slopes, ([mount, perSecond]) => [mount, -perSecond * DAY_S]));
}

function trend(bytesPerDay: number | null, availBytes: number | null): StorageTrend {
  if (bytesPerDay === null || !Number.isFinite(bytesPerDay)) {
    return { bytesPerDay: null, display: "—", daysToFull: null, fullDisplay: "no history yet" };
  }
  if (Math.abs(bytesPerDay) < NOISE_FLOOR_PER_DAY) {
    return { bytesPerDay, display: "steady", daysToFull: null, fullDisplay: "not filling" };
  }

  const sign = bytesPerDay > 0 ? "+" : "−";
  const shown = `${sign}${bytes(Math.abs(bytesPerDay))}/day`;
  if (bytesPerDay <= 0 || availBytes === null) {
    return { bytesPerDay, display: shown, daysToFull: null, fullDisplay: bytesPerDay < 0 ? "freeing up" : "—" };
  }

  const days = availBytes / bytesPerDay;
  return {
    bytesPerDay,
    display: shown,
    daysToFull: days,
    // Past a year the fit is extrapolating far beyond its own window, so the
    // page says the shape of the answer rather than a date nobody should plan
    // around.
    fullDisplay: days > 365 ? "full in over a year" : `full in ~${Math.max(1, Math.round(days))} days`,
  };
}

/** One entry per filesystem, not per mountpoint. Grouped by device, and the
 *  primary path is the machine's headline mount when that is one of them —
 *  otherwise the shallowest path, which is the one the box was set up around. */
function distinct(
  instance: "homelab" | "nas",
  list: Filesystem[],
  slopes: Map<string, number>,
): StorageMount[] {
  const headline = HOSTS[instance].mount;
  const groups = new Map<string, Filesystem[]>();
  for (const fs of list) {
    const key = fs.device === "?" ? `mount:${fs.mountpoint}` : fs.device;
    groups.set(key, [...(groups.get(key) ?? []), fs]);
  }

  const depth = (path: string) => path.split("/").filter(Boolean).length;

  return Array.from(groups.values())
    .map((group): StorageMount => {
      const sorted = [...group].sort(
        (a, b) =>
          Number(b.mountpoint === headline) - Number(a.mountpoint === headline) ||
          depth(a.mountpoint) - depth(b.mountpoint) ||
          a.mountpoint.length - b.mountpoint.length,
      );
      const primary = sorted[0]!;
      // The slope of any path onto this filesystem describes the filesystem, so
      // take whichever alias Prometheus actually has a fit for.
      const slope = sorted.map((f) => slopes.get(f.mountpoint)).find((s) => s !== undefined) ?? null;
      return {
        ...primary,
        instance,
        aliases: sorted.slice(1).map((f) => f.mountpoint),
        headline: primary.mountpoint === headline,
        health: fsHealth(primary.percent),
        trend: trend(slope, primary.availBytes),
      };
    })
    .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
}

function total(mounts: StorageMount[]): { size: number | null; avail: number | null } {
  const counted = mounts.filter((m) => m.sizeBytes !== null && m.availBytes !== null);
  if (counted.length === 0) return { size: null, avail: null };
  return {
    size: counted.reduce((n, m) => n + (m.sizeBytes ?? 0), 0),
    avail: counted.reduce((n, m) => n + (m.availBytes ?? 0), 0),
  };
}

/** When the last filesystem sample for a machine was written, as an ISO string.
 *
 *  A subquery rather than `timestamp(last_over_time(...))`, which looks like it
 *  answers this and does not: `last_over_time` restamps the sample it returns
 *  with the evaluation time, so that expression cheerfully reports "now" for a
 *  machine that died yesterday. Stepping `timestamp()` over the window and
 *  taking the maximum reads the real sample time.
 *
 *  Read from the series rather than from `up`, because the question is how old
 *  these numbers are, not when the machine last answered anything at all. */
async function lastSampleAt(instance: string): Promise<string | null> {
  const seconds = await scalar(
    `max(max_over_time(timestamp(node_filesystem_avail_bytes{instance="${instance}"})[${STALE_LOOKBACK}:5m]))`,
  );
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}

async function collectHostStorage(instance: "homelab" | "nas"): Promise<StorageHost> {
  const spec = HOSTS[instance];
  const [fresh, slopes] = await Promise.all([
    soft(collectFilesystems(instance)),
    soft(collectTrends(instance)),
  ]);

  // A machine that is not answering right now still had a pool an hour ago, and
  // that number is almost certainly still true. Show it, and say how old it is —
  // a blank card would hide a fact rather than admit to not knowing one.
  const reporting = (fresh ?? []).length > 0;
  const [list, asOf] = reporting
    ? [fresh ?? [], null]
    : await Promise.all([
        soft(collectFilesystems(instance, STALE_LOOKBACK)).then((l) => l ?? []),
        soft(lastSampleAt(instance)),
      ]);

  const mounts = distinct(instance, list, slopes ?? new Map());
  const { size, avail } = total(mounts);
  const used = size !== null && avail !== null ? size - avail : null;
  const percent = size !== null && avail !== null && size > 0 ? 100 * (1 - avail / size) : null;

  const fits = mounts.map((m) => m.trend.bytesPerDay).filter((n): n is number => n !== null);
  const hostSlope = fits.length === 0 ? null : fits.reduce((n, v) => n + v, 0);

  return {
    instance,
    name: spec.name,
    role: spec.role,
    reporting,
    asOf: reporting ? null : (asOf ?? null),
    sizeBytes: size,
    usedBytes: used,
    availBytes: avail,
    percent,
    sizeDisplay: display(size, "bytes"),
    usedDisplay: display(used, "bytes"),
    availDisplay: display(avail, "bytes"),
    health: fsHealth(percent),
    mounts,
    trend: trend(hostSlope, avail),
  };
}

async function assemble(): Promise<StorageSummary> {
  const hosts = await Promise.all([collectHostStorage("homelab"), collectHostStorage("nas")]);

  const counted = hosts.filter((h) => h.reporting && h.sizeBytes !== null && h.availBytes !== null);
  const size = counted.length === 0 ? null : counted.reduce((n, h) => n + (h.sizeBytes ?? 0), 0);
  const avail = counted.length === 0 ? null : counted.reduce((n, h) => n + (h.availBytes ?? 0), 0);
  const used = size !== null && avail !== null ? size - avail : null;

  return {
    at: new Date().toISOString(),
    hosts,
    estate: {
      sizeBytes: size,
      usedBytes: used,
      availBytes: avail,
      percent: size !== null && avail !== null && size > 0 ? 100 * (1 - avail / size) : null,
      sizeDisplay: display(size, "bytes"),
      usedDisplay: display(used, "bytes"),
      availDisplay: display(avail, "bytes"),
    },
  };
}

export function storageSummary(): Promise<StorageSummary> {
  return cache.get("storage", assemble);
}
