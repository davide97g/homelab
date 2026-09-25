import type { Unit } from "./wire.js";

// Formatting lives on the server. The browser prints `Metric.display` and never
// computes it, so a byte is a byte everywhere and there is no second
// implementation to drift.
//
// This is the one hand-mirrored pair left in the repo -- frontend/src/lib/format.ts
// exists for the few places the browser formats a number it derived itself (a
// chart axis tick). Keep them in step.

const KIB = 1024;

export function bytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = Math.abs(n);
  let i = 0;
  while (value >= KIB && i < units.length - 1) {
    value /= KIB;
    i += 1;
  }
  const digits = value < 10 && i > 0 ? 1 : 0;
  return `${(n < 0 ? -value : value).toFixed(digits)} ${units[i]}`;
}

export function rate(bytesPerSec: number | null): string {
  if (bytesPerSec === null || !Number.isFinite(bytesPerSec)) return "—";
  return `${bytes(bytesPerSec)}/s`;
}

export function bits(bitsPerSec: number | null): string {
  if (bitsPerSec === null || !Number.isFinite(bitsPerSec)) return "—";
  const units = ["bit/s", "kbit/s", "Mbit/s", "Gbit/s"];
  let value = bitsPerSec;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i += 1;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Coarse on purpose: "2 days" tells you what you want from an uptime, "2 days,
 *  14 hours, 3 minutes" makes you read it. */
export function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export function compact(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return new Intl.NumberFormat("en", { notation: "compact" }).format(n);
  return String(Math.round(n));
}

export function display(value: number | null, unit: Unit): string {
  if (value === null || !Number.isFinite(value)) return "—";
  switch (unit) {
    case "percent":
      return `${value.toFixed(value < 10 ? 1 : 0)}%`;
    case "bytes":
      return bytes(value);
    case "bytesPerSec":
      return rate(value);
    case "bitsPerSec":
      return bits(value);
    case "celsius":
      return `${value.toFixed(1)} °C`;
    case "watts":
      return `${value.toFixed(value < 10 ? 1 : 0)} W`;
    case "kwh":
      return `${value.toFixed(2)} kWh`;
    case "eur":
      return `€${value.toFixed(2)}`;
    case "seconds":
      return duration(value);
    case "ratio":
      return value.toFixed(2);
    case "hertz":
      return value >= 1e9 ? `${(value / 1e9).toFixed(2)} GHz` : `${(value / 1e6).toFixed(0)} MHz`;
    case "count":
    default:
      return compact(value);
  }
}
