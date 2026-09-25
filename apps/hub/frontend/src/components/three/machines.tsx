import type { HotspotState } from "@wire";
import { useMemo } from "react";
import { CHASSIS, CHASSIS_DARK, PANEL, tiled } from "@/components/three/materials";
import { Lamp, Panel } from "@/components/three/parts";
import type { ToneColors } from "@/components/three/webgl";

// The hardware, hand-built from primitives. Placement is a prop so the same
// geometry serves the hero — one machine, filling the frame — and the topology
// scene, where both stand on their own floor slabs.

export type Placement = {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
};

type MachineProps = Placement & {
  hotspots: Record<string, HotspotState>;
  colors: ToneColors;
};

/** GMKtec M6 Ultra: a squat square chassis, perforated top, the round power
 *  button and the port row on the front, heat-sink fins out the right flank.
 *  The hotspot keys match mini-pc-flat.tsx exactly. */
export function MiniPc({ hotspots, colors, position, rotation, scale }: MachineProps) {
  const pattern = useMemo(() => tiled(14), []);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group position={[0, 0.05, 0]}>
        <mesh>
          <boxGeometry args={[2, 0.72, 2]} />
          <meshStandardMaterial color={CHASSIS} roughness={0.52} metalness={0.42} />
        </mesh>

        {/* Perforated top plate. */}
        <mesh position={[0, 0.362, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.7, 1.7]} />
          <meshStandardMaterial map={pattern} color="#6a6f78" roughness={0.9} metalness={0.1} />
        </mesh>

        {/* Front bezel, a shade darker so the face reads as a face. */}
        <mesh position={[0, 0, 1.002]}>
          <planeGeometry args={[1.96, 0.68]} />
          <meshStandardMaterial color={CHASSIS_DARK} roughness={0.7} metalness={0.2} />
        </mesh>

        {/* The power button carries CPU load. */}
        <Lamp hotspot={hotspots.power} colors={colors} position={[-0.62, 0.02, 1.01]} radius={0.075} halo={0.42} />

        {/* Two USB-A ports light with disk throughput; the jack and the USB-C
            stay inert because nothing measures them. */}
        <mesh position={[-0.28, -0.02, 1.006]}>
          <circleGeometry args={[0.035, 14]} />
          <meshStandardMaterial color={PANEL} roughness={0.9} />
        </mesh>
        <mesh position={[-0.12, -0.02, 1.006]}>
          <planeGeometry args={[0.1, 0.045]} />
          <meshStandardMaterial color={PANEL} roughness={0.9} />
        </mesh>
        <Lamp hotspot={hotspots.nvme} colors={colors} position={[0.08, -0.02, 1.01]} radius={0.03} halo={0.18} />
        <Lamp hotspot={hotspots.nvme} colors={colors} position={[0.28, -0.02, 1.01]} radius={0.03} halo={0.18} />

        {/* Heat-sink fins on the right flank, warming with the hottest sensor. */}
        {[-0.5, 0, 0.5].map((z) => (
          <Panel
            key={z}
            hotspot={hotspots.vents}
            colors={colors}
            position={[1.003, 0.02, z]}
            rotation={[0, Math.PI / 2, 0]}
            args={[0.34, 0.44]}
          />
        ))}

        {/* The 2.5 GbE link LED, on the top face near the rear edge. */}
        <Lamp
          hotspot={hotspots.nic}
          colors={colors}
          position={[0.55, 0.365, -0.62]}
          rotation={[-Math.PI / 2, 0, 0]}
          radius={0.045}
          halo={0.3}
        />

        {[-0.8, 0.8].map((x) =>
          [-0.8, 0.8].map((z) => (
            <mesh key={`${x}:${z}`} position={[x, -0.375, z]}>
              <cylinderGeometry args={[0.07, 0.07, 0.04, 8]} />
              <meshStandardMaterial color={PANEL} roughness={0.95} />
            </mesh>
          )),
        )}
      </group>
    </group>
  );
}

/** UGREEN DXP4800 Pro.
 *
 *  Modelled from the actual machine, which is a squat horizontal box with the
 *  four bays side by side — 01 02 03 04 across the front — not the upright tower
 *  this was until now. It had been wrong since the WebGL phase and nobody had
 *  put a photo next to it.
 *
 *  Empty bays stay dark, and that is the point: three unlit doors next to a
 *  single-member array is the storage story in one glance. */
export function Nas({ hotspots, colors, position, rotation, scale }: MachineProps) {
  const pattern = useMemo(() => tiled(8), []);
  // Four doors across, evenly spaced, as they are labelled on the chassis.
  const bayX = [-0.63, -0.21, 0.21, 0.63];

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh>
        <boxGeometry args={[1.9, 1.45, 1.75]} />
        <meshStandardMaterial color={CHASSIS} roughness={0.55} metalness={0.4} />
      </mesh>

      {/* Front face. */}
      <mesh position={[0, 0, 0.877]}>
        <planeGeometry args={[1.86, 1.41]} />
        <meshStandardMaterial color={CHASSIS_DARK} roughness={0.72} metalness={0.18} />
      </mesh>

      {bayX.map((x, i) => (
        <group key={i}>
          {/* A door: tall and narrow, sitting above the control strip. */}
          {/* Solid rather than perforated. The mesh texture multiplies against
              the material colour, and at a door's size that lands somewhere
              around 0.11 luminance — the four doors turned the whole front face
              into one black rectangle. The real ones are brushed metal anyway;
              the perforation belongs on the fan, which keeps it. */}
          <mesh position={[x, 0.16, 0.887]}>
            <planeGeometry args={[0.38, 0.98]} />
            <meshStandardMaterial color="#8b9099" roughness={0.62} metalness={0.35} />
          </mesh>
          {/* The round latch in the lower half of each door — without it the
              doors read as four stickers. */}
          <mesh position={[x, -0.12, 0.893]}>
            <circleGeometry args={[0.075, 16]} />
            <meshStandardMaterial color={PANEL} roughness={0.95} />
          </mesh>
          {/* Drive activity sits at the top of its own door. */}
          <Lamp hotspot={hotspots[`bay${i}`]} colors={colors} position={[x, 0.56, 0.897]} radius={0.032} halo={0} />
        </group>
      ))}

      {/* The control strip along the bottom: power button at the left, then the
          little row of status LEDs. */}
      <mesh position={[-0.72, -0.52, 0.893]}>
        <circleGeometry args={[0.055, 16]} />
        <meshStandardMaterial color={PANEL} roughness={0.9} />
      </mesh>
      <Lamp hotspot={hotspots.led} colors={colors} position={[-0.47, -0.52, 0.897]} radius={0.042} halo={0.28} />

      {/* Fan on the right flank, warming with the hottest sensor. */}
      <mesh position={[0.953, 0.12, -0.1]} rotation={[0, Math.PI / 2, 0]}>
        <circleGeometry args={[0.5, 28]} />
        <meshStandardMaterial map={pattern} color="#4a4f58" roughness={0.95} />
      </mesh>
      <Panel
        hotspot={hotspots.fan}
        colors={colors}
        position={[0.958, 0.12, -0.1]}
        rotation={[0, Math.PI / 2, 0]}
        args={[0.86, 0.86]}
        floor={0.04}
        ceiling={0.42}
      />

      <Lamp
        hotspot={hotspots.nic0}
        colors={colors}
        position={[0.958, -0.5, 0.42]}
        rotation={[0, Math.PI / 2, 0]}
        radius={0.038}
        halo={0.24}
      />

      {[-0.75, 0.75].map((x) =>
        [-0.62, 0.62].map((z) => (
          <mesh key={`${x}:${z}`} position={[x, -0.745, z]}>
            <cylinderGeometry args={[0.07, 0.07, 0.05, 8]} />
            <meshStandardMaterial color={PANEL} roughness={0.95} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** The NOUS A1T, which is a white brick with one LED. Drawn small and plain on
 *  purpose: it is the smallest thing in the estate and it is load-bearing, since
 *  wall power is measured rather than modelled only while it answers. */
export function SmartPlug({ hotspots, colors, position, rotation, scale }: MachineProps) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh>
        <boxGeometry args={[0.62, 0.62, 0.42]} />
        <meshStandardMaterial color="#d8d4cc" roughness={0.75} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0, 0.212]}>
        <circleGeometry args={[0.2, 20]} />
        <meshStandardMaterial color="#c3bfb6" roughness={0.9} />
      </mesh>
      <Lamp hotspot={hotspots.plug} colors={colors} position={[0, -0.2, 0.215]} radius={0.05} halo={0.3} />
    </group>
  );
}

/** A router, as a flat slab with an aerial. Nothing scrapes either of the two on
 *  this page, so it carries no lamp at all — an unlit glyph is the honest shape
 *  for a device that is on the path and not in the monitoring. */
export function Router({ position, rotation, scale }: Placement) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh>
        <boxGeometry args={[1.1, 0.16, 0.72]} />
        <meshStandardMaterial color="#4c4f57" roughness={0.8} metalness={0.15} />
      </mesh>
      <mesh position={[0.42, 0.26, -0.24]} rotation={[0.25, 0, -0.2]}>
        <boxGeometry args={[0.05, 0.5, 0.12]} />
        <meshStandardMaterial color="#3a3d44" roughness={0.85} />
      </mesh>
      <mesh position={[-0.42, 0.26, -0.24]} rotation={[0.25, 0, 0.2]}>
        <boxGeometry args={[0.05, 0.5, 0.12]} />
        <meshStandardMaterial color="#3a3d44" roughness={0.85} />
      </mesh>
    </group>
  );
}
