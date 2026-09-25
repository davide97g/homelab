import type { HotspotState } from "@wire";
import { Canvas } from "@react-three/fiber";
import { useRef } from "react";
import { FrameDriver, useActive } from "@/components/three/loop";
import { MiniPc, Nas } from "@/components/three/machines";
import { ContactShadow, Parallax } from "@/components/three/parts";
import { useToneColors } from "@/components/three/webgl";
import { cn } from "@/lib/utils";

// One machine, filling the frame. The geometry, the lamps and the frame loop all
// live in components/three now, because the topology scene draws the same boxes
// — see components/three/parts.tsx for the rules they are built to.
//
// This file is lazily imported and, with the topology scene, is one of only two
// entry points to three and fiber, so ~190 kB gzipped stays out of the initial
// bundle and off every page that is not showing hardware.

const VIEW = {
  homelab: { position: [2.9, 2.1, 3.5] as [number, number, number], target: 0, shadowY: -0.34, shadowSize: 5 },
  nas: { position: [2.1, 1.25, 4.3] as [number, number, number], target: 0, shadowY: -0.78, shadowSize: 5 },
};

/** Lit by hand, three lights: a key from the front left so the face is read
 *  first, a cool fill from behind right to keep the far edge off the background,
 *  and enough ambient that a dark chassis is not a silhouette. */
function Lights() {
  return (
    <>
      <ambientLight intensity={1.1} />
      <directionalLight position={[4, 6, 5]} intensity={2.4} color="#fff4e8" />
      <directionalLight position={[-5, 2, -4]} intensity={0.9} color="#9fc4ff" />
      {/* A soft fill straight down the camera axis. Without it every face
          turned towards the reader — which is where all the lamps and all the
          bay doors are — is lit by ambient alone and reads as black. */}
      <directionalLight position={[0, 1.5, 8]} intensity={0.55} color="#ffffff" />
    </>
  );
}

export default function HeroScene({
  machine,
  hotspots,
  className,
}: {
  machine: "homelab" | "nas";
  hotspots: Record<string, HotspotState>;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const active = useActive(host);
  const colors = useToneColors();
  const view = VIEW[machine];

  return (
    <div ref={host} className={cn("aspect-[7/5] w-full max-w-[420px]", className)}>
      <Canvas
        frameloop="never"
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: view.position, fov: 32 }}
        onCreated={({ camera }) => camera.lookAt(0, view.target, 0)}
      >
        <FrameDriver active={active} />
        <Lights />
        <Parallax>
          {machine === "homelab" ? (
            <MiniPc hotspots={hotspots} colors={colors} />
          ) : (
            <Nas hotspots={hotspots} colors={colors} />
          )}
        </Parallax>
        <ContactShadow y={view.shadowY} size={view.shadowSize} />
      </Canvas>
    </div>
  );
}
