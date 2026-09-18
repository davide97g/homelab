import { display } from "../format.js";
import type { HotspotState, Tone } from "../wire.js";

// Metrics to glowing things. Pure functions, computed server-side, because the
// same numbers drive two renderers: the WebGL models and the flat SVG fallback a
// phone gets. Keeping the mapping here means a tweak is a server deploy rather
// than a rebuild, and the two can never drift apart.

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function state(
  label: string,
  value: string,
  level: number,
  tone: Tone,
  pulse = 0,
): HotspotState {
  return { label, value, level: clamp01(level), tone, pulse };
}

/** Throughput is logarithmic to the eye: the difference between idle and 1 MB/s
 *  matters, the difference between 200 and 201 MB/s does not. Scaled against
 *  2.5 Gb/s, which is what the box's NIC negotiates. */
function throughputLevel(bytesPerSec: number | null): number {
  if (bytesPerSec === null || bytesPerSec <= 0) return 0;
  return clamp01(Math.log1p(bytesPerSec * 8) / Math.log1p(2.5e9));
}

/** 35 °C is a cold idle box, 85 °C is where the CPUHot alert lives. Below the
 *  warn threshold it reads as accent rather than green, because a working
 *  machine being slightly warm is not a state worth colouring as "good". */
function heat(tempC: number | null): { level: number; tone: Tone } {
  if (tempC === null) return { level: 0, tone: "default" };
  const level = clamp01((tempC - 35) / (85 - 35));
  const tone: Tone = tempC >= 85 ? "bad" : tempC >= 70 ? "warn" : "accent";
  return { level, tone };
}

export function miniPcHotspots(input: {
  cpuPercent: number | null;
  tempC: number | null;
  rx: number | null;
  tx: number | null;
  diskRead: number | null;
  diskWrite: number | null;
  load1: number | null;
  cores: number | null;
}): Record<string, HotspotState> {
  const cpu = input.cpuPercent ?? 0;
  const thermal = heat(input.tempC);
  const net = (input.rx ?? 0) + (input.tx ?? 0);
  const disk = (input.diskRead ?? 0) + (input.diskWrite ?? 0);
  // The green power button is the thing your eye lands on, so it carries load.
  // Pulse rate comes from load per thread rather than CPU percent: a box at 100%
  // on one core is not under pressure, a box with a run queue is.
  const pressure =
    input.load1 !== null && input.cores ? clamp01(input.load1 / input.cores) : clamp01(cpu / 100);

  return {
    power: state("CPU", display(input.cpuPercent, "percent"), 0.15 + 0.85 * clamp01(cpu / 100),
      cpu >= 85 ? "bad" : cpu >= 50 ? "warn" : "good", 0.5 + pressure * 2),
    vents: state("Hottest sensor", display(input.tempC, "celsius"), thermal.level, thermal.tone),
    nic: state("Network", display(net || null, "bytesPerSec"), throughputLevel(net || null), "accent",
      net > 0 ? Math.min(8, 1 + Math.log1p(net / 1e5)) : 0),
    nvme: state("Disk", display(disk || null, "bytesPerSec"), throughputLevel(disk || null), "accent",
      disk > 0 ? Math.min(6, 1 + Math.log1p(disk / 1e5)) : 0),
  };
}

export function nasHotspots(input: {
  cpuPercent: number | null;
  tempC: number | null;
  rx: number | null;
  tx: number | null;
  fsPercent: number | null;
  raid: { members: number; expected: number } | null;
}): Record<string, HotspotState> {
  const cpu = input.cpuPercent ?? 0;
  const thermal = heat(input.tempC);
  const net = (input.rx ?? 0) + (input.tx ?? 0);
  const fill = input.fsPercent === null ? 0 : input.fsPercent / 100;
  const degraded = input.raid !== null && input.raid.members < input.raid.expected;

  // Four bays, one disk. Bays 1-3 are drawn unlit and matte because they are
  // empty, which is the honest picture: md1 is a raid1 with a single member, so
  // the array label promises redundancy the hardware does not have.
  const bays: Record<string, HotspotState> = {
    bay0: state("Bay 1 · /volume1", display(input.fsPercent, "percent"), fill,
      fill >= 0.9 ? "bad" : fill >= 0.8 ? "warn" : "good"),
    bay1: state("Bay 2", "empty", 0, "default"),
    bay2: state("Bay 3", "empty", 0, "default"),
    bay3: state("Bay 4", "empty", 0, "default"),
  };

  return {
    ...bays,
    led: degraded
      ? state("Array", "degraded", 1, "bad", 0.5)
      : state("Status", display(input.cpuPercent, "percent"), 0.2 + 0.8 * clamp01(cpu / 100), "good", 0.4),
    fan: state("Hottest sensor", display(input.tempC, "celsius"), thermal.level, thermal.tone),
    nic0: state("Network", display(net || null, "bytesPerSec"), throughputLevel(net || null), "accent",
      net > 0 ? Math.min(6, 1 + Math.log1p(net / 1e5)) : 0),
  };
}
