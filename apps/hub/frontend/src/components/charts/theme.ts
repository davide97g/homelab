import type { Unit } from "@wire";

// uPlot draws to a canvas, so it cannot use a Tailwind class or a CSS variable
// directly: it needs resolved colour strings. These are read once from the
// document and re-read when the theme flips, which is the whole cost of using a
// canvas chart in a token-driven design system.

export type ChartTheme = {
  axis: string;
  grid: string;
  text: string;
  muted: string;
  series: string[];
  resolve: (name: string | undefined, index: number) => string;
};

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Some browsers still refuse `oklch()` inside a canvas fill on older engines.
 *  Rather than shipping a colour-space conversion, let the browser do it: paint
 *  the value onto a throwaway element and read back what it computed. */
function concrete(value: string): string {
  if (!value) return "#888";
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || value;
}

export function readTheme(): ChartTheme {
  const series = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => concrete(css(`--chart-${i}`)));
  const tones: Record<string, string> = {
    "tone-good": concrete(css("--tone-good")),
    "tone-warn": concrete(css("--tone-warn")),
    "tone-bad": concrete(css("--tone-bad")),
    "tone-accent": concrete(css("--tone-accent")),
    "tone-default": concrete(css("--tone-default")),
  };

  return {
    axis: concrete(css("--border")),
    grid: concrete(css("--border")),
    text: concrete(css("--muted-foreground")),
    muted: concrete(css("--muted")),
    series,
    resolve(name, index) {
      if (name && name in tones) return tones[name]!;
      if (name?.startsWith("chart-")) {
        const n = Number(name.slice("chart-".length));
        if (Number.isFinite(n) && series[n - 1]) return series[n - 1]!;
      }
      return series[index % series.length]!;
    },
  };
}

/** Axis and tooltip formatting. The server formats every number it sends; this
 *  is for the values the chart derives itself, which is only ever a tick. */
export function formatValue(v: number | null | undefined, unit: Unit): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";

  const scale = (n: number, units: string[], base: number) => {
    const sign = n < 0 ? "-" : "";
    let value = Math.abs(n);
    let i = 0;
    while (value >= base && i < units.length - 1) {
      value /= base;
      i += 1;
    }
    return `${sign}${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  };

  switch (unit) {
    case "percent":
      return `${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
    case "bytes":
      return scale(v, ["B", "KiB", "MiB", "GiB", "TiB"], 1024);
    case "bytesPerSec":
      return `${scale(v, ["B", "KiB", "MiB", "GiB"], 1024)}/s`;
    case "bitsPerSec":
      return scale(v, ["bit/s", "kbit/s", "Mbit/s", "Gbit/s"], 1000);
    case "celsius":
      return `${v.toFixed(1)} °C`;
    case "watts":
      return `${v.toFixed(Math.abs(v) < 10 ? 1 : 0)} W`;
    case "kwh":
      return `${v.toFixed(2)} kWh`;
    case "eur":
      return `€${v.toFixed(2)}`;
    case "hertz":
      return scale(v, ["Hz", "kHz", "MHz", "GHz"], 1000);
    case "ratio":
      return v.toFixed(2);
    case "seconds":
      return `${v.toFixed(0)}s`;
    case "count":
    default:
      return Math.abs(v) >= 1000 ? scale(v, ["", "k", "M", "G"], 1000).replace(" ", "") : String(Math.round(v * 100) / 100);
  }
}
