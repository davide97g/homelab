import type { Tone, Transport } from "@wire";
import { useEffect, useState } from "react";
import { readTheme } from "@/components/charts/theme";

// Who gets the 3D scene, and what colour anything in it is.
//
// three + fiber is ~190 kB gzipped and a live GPU surface. That is worth it on a
// desktop looking at the hero and not worth it on a phone, under a
// reduced-motion preference, or on a machine whose WebGL context creation fails
// — and all three of those already have a real renderer waiting in the flat SVG,
// which is fed by exactly the same HotspotState map.

/** Cached, because creating a probe context is not free and the answer cannot
 *  change without a reload. */
let webglSupport: boolean | null = null;

export function canRenderWebgl(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    // Release it immediately: browsers cap the number of live contexts per page
    // and a leaked probe costs one of them.
    const lose = gl?.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    webglSupport = Boolean(gl);
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

/** `flat` or `webgl`, and it re-answers when the viewport or the motion
 *  preference changes rather than only at mount — a laptop being plugged into a
 *  monitor is a resize, not a reload. */
export function useRenderer(): "webgl" | "flat" {
  const [mode, setMode] = useState<"webgl" | "flat">("flat");

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 767px)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => setMode(!narrow.matches && !calm.matches && canRenderWebgl() ? "webgl" : "flat");

    decide();
    narrow.addEventListener("change", decide);
    calm.addEventListener("change", decide);
    return () => {
      narrow.removeEventListener("change", decide);
      calm.removeEventListener("change", decide);
    };
  }, []);

  return mode;
}

/** The tone tokens as concrete colour strings, re-read when the theme flips.
 *
 *  A material cannot take `var(--tone-good)`, and hand-picking a second value
 *  per tone for the dark theme is exactly the duplication the token maps in
 *  primitives.tsx exist to avoid. So the values are read out of the document,
 *  the same way the chart canvas reads them. */
export type ToneColors = Record<Tone, string>;

function read(): ToneColors {
  const theme = readTheme();
  return {
    default: theme.resolve("tone-default", 0),
    good: theme.resolve("tone-good", 0),
    warn: theme.resolve("tone-warn", 0),
    bad: theme.resolve("tone-bad", 0),
    accent: theme.resolve("tone-accent", 0),
  };
}

export function useToneColors(): ToneColors {
  const [colors, setColors] = useState<ToneColors>(read);

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return colors;
}

/** Everything the topology scene needs to colour itself, read once.
 *
 *  One hook and one observer rather than three: the scene wants tones for the
 *  device lamps, the categorical ramp for the conduits, and two surface colours
 *  for the floors, and they all come from the same document read.
 *
 *  Links are coloured by *transport*, from the categorical ramp, and not by the
 *  semantic tokens. Orange means power and cyan means throughput on every other
 *  page in this app, and a topology scene that spent them on "this hop is a
 *  tunnel" would break that everywhere at once. Status still overrides: a link
 *  that is down or unverified takes its tone instead, which is the one thing
 *  that should be able to shout over the palette. */
const TRANSPORT_TOKEN: Record<Transport, string> = {
  tailnet: "chart-2",
  tunnel: "chart-4",
  internet: "chart-4",
  lan: "chart-8",
  wifi: "chart-6",
};

export type SceneColors = {
  tone: ToneColors;
  transport: Record<Transport, string>;
  /** The floor slabs and their outlines. */
  surface: string;
  outline: string;
};

function readScene(): SceneColors {
  const theme = readTheme();
  const transport = {} as Record<Transport, string>;
  for (const [key, token] of Object.entries(TRANSPORT_TOKEN)) {
    transport[key as Transport] = theme.resolve(token, 0);
  }
  return { tone: read(), transport, surface: theme.muted, outline: theme.text };
}

export function useSceneColors(): SceneColors {
  const [colors, setColors] = useState<SceneColors>(readScene);

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readScene()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return colors;
}
