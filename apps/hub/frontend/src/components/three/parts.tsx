import type { HotspotState, Tone } from "@wire";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { glow, shadow } from "@/components/three/materials";
import type { ToneColors } from "@/components/three/webgl";

// The pieces every scene in this app is built from.
//
// Rules these obey, each of which was a real cost somewhere, and which now
// govern two scenes rather than one:
//
//   No GLTF and no drei `<Environment preset>`. Both fetch from a CDN at
//   runtime, which fails behind Cloudflare Access — the page would render a
//   silhouette in the dark for anyone outside the LAN. Everything is boxes,
//   circles and two canvas-generated textures, and the lighting is by hand.
//
//   No shadow maps and no postprocessing. The contact shadow is one transparent
//   plane with a radial texture, and the bloom is additive sprites, which gets
//   most of the look for a few percent of the cost.
//
//   A draw-call budget, and a dpr cap. These run next to a polling dashboard on
//   an integrated GPU. The hero scene holds ~22 calls at dpr 1.75; the topology
//   scene is full-bleed and holds a lower cap for the same reason.
//
// The hotspots are not computed here. They arrive in the payload from
// server/src/collect/hotspots.ts, and the flat SVG fallbacks read exactly the
// same map — one data path, two renderers.

/** One lit thing: an emissive disc, and optionally an additive sprite behind it
 *  standing in for bloom. Level and pulse come straight from the server's
 *  HotspotState, so nothing here decides what "hot" means. */
export function Lamp({
  hotspot,
  colors,
  position,
  rotation,
  radius = 0.05,
  halo = 0.34,
}: {
  hotspot: HotspotState | undefined;
  colors: ToneColors;
  position: [number, number, number];
  rotation?: [number, number, number];
  radius?: number;
  halo?: number;
}) {
  const core = useRef<THREE.MeshBasicMaterial>(null);
  const aura = useRef<THREE.SpriteMaterial>(null);
  const colour = colors[hotspot?.tone ?? ("default" as Tone)];

  useFrame(({ clock }) => {
    const base = 0.22 + 0.78 * (hotspot?.level ?? 0);
    const pulse = hotspot?.pulse ?? 0;
    const k = pulse > 0 ? 0.62 + 0.38 * Math.sin(clock.elapsedTime * pulse * Math.PI) : 1;
    if (core.current) core.current.opacity = Math.min(1, base * k);
    if (aura.current) aura.current.opacity = Math.min(1, base * k * 0.6);
  });

  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <circleGeometry args={[radius, 20]} />
        <meshBasicMaterial ref={core} color={colour} transparent toneMapped={false} />
      </mesh>
      {halo > 0 && (
        <sprite scale={[halo, halo, 1]} position={[0, 0, 0.005]}>
          <spriteMaterial
            ref={aura}
            map={glow()}
            color={colour}
            blending={THREE.AdditiveBlending}
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      )}
    </group>
  );
}

/** A flat emissive panel, for the vent fins and the fan disc: the same idea as a
 *  Lamp without the sprite, because a whole face glowing additively reads as fog
 *  rather than as heat. */
export function Panel({
  hotspot,
  colors,
  position,
  rotation,
  args,
  floor = 0.08,
  ceiling = 0.7,
}: {
  hotspot: HotspotState | undefined;
  colors: ToneColors;
  position: [number, number, number];
  rotation?: [number, number, number];
  args: [number, number];
  floor?: number;
  ceiling?: number;
}) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const colour = colors[hotspot?.tone ?? ("default" as Tone)];

  useFrame(() => {
    if (mat.current) mat.current.opacity = floor + ceiling * (hotspot?.level ?? 0);
  });

  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={args} />
      <meshBasicMaterial ref={mat} color={colour} transparent toneMapped={false} />
    </mesh>
  );
}

export function ContactShadow({
  y,
  size,
  x = 0,
  z = 0,
  opacity = 0.75,
}: {
  y: number;
  size: number;
  x?: number;
  z?: number;
  opacity?: number;
}) {
  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={shadow()} transparent depthWrite={false} opacity={opacity} toneMapped={false} />
    </mesh>
  );
}

/** A few degrees of tilt following the pointer. Not a turntable: a dashboard
 *  element that rotates on its own is movement in the corner of your eye all
 *  day, and this one only moves when you are looking at it. */
export function Parallax({
  children,
  yaw = 0.22,
  pitch = 0.1,
}: {
  children: React.ReactNode;
  yaw?: number;
  pitch?: number;
}) {
  const group = useRef<THREE.Group>(null);

  useFrame(({ pointer }) => {
    if (!group.current) return;
    const targetY = pointer.x * yaw;
    const targetX = -pointer.y * pitch;
    group.current.rotation.y += (targetY - group.current.rotation.y) * 0.08;
    group.current.rotation.x += (targetX - group.current.rotation.x) * 0.08;
  });

  return <group ref={group}>{children}</group>;
}
