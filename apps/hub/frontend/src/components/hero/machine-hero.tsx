import type { HotspotState } from "@wire";
import { lazy, Suspense } from "react";
import { MiniPcFlat } from "@/components/hero/mini-pc-flat";
import { NasFlat } from "@/components/hero/nas-flat";
import { useRenderer } from "@/components/three/webgl";

/** One machine, two renderers, one data path.
 *
 *  The flat SVG is not a placeholder and is not a downgrade in information: it
 *  reads the same `HotspotState` map the WebGL scene does, so a phone sees
 *  exactly what a desktop sees, drawn differently. That is what makes it safe to
 *  keep three out of the initial bundle — the lazy chunk carries no data of its
 *  own, so failing to load it costs nothing but the depth.
 *
 *  The Suspense fallback is the flat model rather than a spinner for the same
 *  reason: during the ~190 kB fetch the page is complete, not loading. */
const HeroScene = lazy(() => import("@/components/hero/scene"));

export function MachineHero({
  machine,
  hotspots,
  className,
}: {
  machine: "homelab" | "nas";
  hotspots: Record<string, HotspotState>;
  className?: string;
}) {
  const renderer = useRenderer();
  const flat =
    machine === "homelab" ? (
      <MiniPcFlat hotspots={hotspots} className={className} />
    ) : (
      <NasFlat hotspots={hotspots} className={className} />
    );

  if (renderer === "flat") return flat;

  return (
    <Suspense fallback={flat}>
      <HeroScene machine={machine} hotspots={hotspots} className={className} />
    </Suspense>
  );
}
