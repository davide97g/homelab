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

/** Every token in this app is `oklch()`, and the two things that have to draw
 *  with them — the uPlot canvas and the three.js materials — both want plain
 *  sRGB. Rather than shipping a colour-space conversion, let the browser do it.
 *
 *  This used to read the value back off a throwaway element's computed `color`,
 *  which is a trick that quietly stopped working: the computed value of `color`
 *  preserves the colour function, so Chrome hands back `oklch(0.265 0.013 63)`
 *  unchanged. uPlot did not care, because a canvas fill parses oklch fine — but
 *  `THREE.Color` cannot, and falls back to **white** without throwing, which is
 *  why every material in the 3D scenes was painting white over whatever token it
 *  had been given.
 *
 *  Painting one pixel and reading it back cannot drift the same way: whatever
 *  comes out of `getImageData` is sRGB bytes by definition. */
let probe: CanvasRenderingContext2D | null = null;

function concrete(value: string): string {
  if (!value) return "#888";
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return value;
  try {
    // A colour the browser cannot parse leaves fillStyle untouched, so the
    // previous pixel would be read back as this one. Clearing first makes an
    // unparseable value obvious rather than contagious.
    probe.fillStyle = "#000000";
    probe.fillStyle = value;
    probe.clearRect(0, 0, 1, 1);
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return value;
  }
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
