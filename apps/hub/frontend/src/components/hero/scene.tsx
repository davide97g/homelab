import type { HotspotState, Tone } from "@wire";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { useToneColors, type ToneColors } from "@/components/hero/webgl";
import { cn } from "@/lib/utils";

// The two machines in WebGL, hand-built from primitives.
//
// This file is lazily imported and is the only place three and fiber appear, so
// ~190 kB gzipped stays out of the initial bundle and off every page that is not
// showing a machine.
//
// Rules this scene is built to, each of which was a real cost somewhere:
//
//   No GLTF and no drei `<Environment preset>`. Both fetch from a CDN at
//   runtime, which fails behind Cloudflare Access — the page would render a
//   silhouette in the dark for anyone outside the LAN. Everything here is boxes,
//   circles and two canvas-generated textures, and the lighting is by hand.
//
//   No shadow maps and no postprocessing. The contact shadow is one transparent
//   plane with a radial texture, and the bloom is additive sprites, which gets
//   most of the look for a few percent of the cost.
//
//   ~22 draw calls and dpr capped at 1.75. This runs next to a polling dashboard
//   on an integrated GPU.
//
// The hotspots are not computed here. They arrive in the payload from
// server/src/collect/hotspots.ts, and the flat SVG fallback reads exactly the
// same map — one data path, two renderers.

// ——— Textures ————————————————————————————————————————————————————————————————
// Built once, lazily, and shared by every instance. A canvas texture is cheap to
// make and free to reuse; making one per lamp would be neither.

let glowTex: THREE.CanvasTexture | null = null;
let shadowTex: THREE.CanvasTexture | null = null;
let meshTex: THREE.CanvasTexture | null = null;

function radial(inner: string, outer: string, size = 128): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glow(): THREE.CanvasTexture {
  glowTex ??= radial("rgba(255,255,255,1)", "rgba(255,255,255,0)");
  return glowTex;
}

function shadow(): THREE.CanvasTexture {
  shadowTex ??= radial("rgba(0,0,0,0.55)", "rgba(0,0,0,0)", 256);
  return shadowTex;
}

/** The perforated panel, as one repeating texture rather than a few hundred
 *  little cylinders. */
function meshPattern(): THREE.CanvasTexture {
  if (!meshTex) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#3a3d44";
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "#111318";
    ctx.beginPath();
    ctx.arc(8, 8, 3.2, 0, Math.PI * 2);
    ctx.fill();
    meshTex = new THREE.CanvasTexture(canvas);
    meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping;
    meshTex.colorSpace = THREE.SRGBColorSpace;
  }
  return meshTex;
}

// ——— The frame loop ——————————————————————————————————————————————————————————

/** A hand-driven loop instead of `frameloop="always"`.
 *
 *  `"demand"` is wrong here: the hotspots pulse continuously, so demand would
 *  mean calling `invalidate()` every frame anyway, which is the always-loop with
 *  extra steps. `"always"` is right in spirit but renders at the display's rate,
 *  and this scene has no business running at 120 Hz behind a dashboard. So the
 *  canvas is `"never"` and this drives `advance()` from one rAF capped at 30 fps
 *  — same continuous animation, half the frames, and the visibility gate is the
 *  same switch.
 *
 *  Going idle still paints once, so the last state stays on screen rather than
 *  freezing mid-pulse at whatever opacity the final frame happened to hold. */
function FrameDriver({ active, fps = 30 }: { active: boolean; fps?: number }) {
  const advance = useThree((s) => s.advance);

  useEffect(() => {
    advance(performance.now());
    if (!active) return;

    const minDelta = 1000 / fps;
    let last = 0;
    let raf = requestAnimationFrame(function tick(t: number) {
      raf = requestAnimationFrame(tick);
      if (t - last < minDelta) return;
      last = t;
      advance(t);
    });

    return () => cancelAnimationFrame(raf);
  }, [active, fps, advance]);

  return null;
}

/** On screen *and* in a foreground tab. Either one alone is not enough: a
 *  backgrounded tab keeps its elements intersecting, and rAF throttling in a
 *  hidden tab is a browser courtesy rather than a guarantee. */
function useActive(ref: RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(false);
  const [foreground, setForeground] = useState(() => !document.hidden);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)), {
      threshold: 0.05,
    });
    io.observe(el);

    const onVisibility = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ref]);

  return onScreen && foreground;
}

// ——— Pieces ——————————————————————————————————————————————————————————————————

const CHASSIS = "#2c2f36";
const CHASSIS_DARK = "#1a1c21";
const PANEL = "#16181c";

/** One lit thing: an emissive disc, and optionally an additive sprite behind it
 *  standing in for bloom. Level and pulse come straight from the server's
 *  HotspotState, so nothing here decides what "hot" means. */
function Lamp({
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
function Panel({
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

function ContactShadow({ y, size }: { y: number; size: number }) {
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={shadow()} transparent depthWrite={false} opacity={0.75} toneMapped={false} />
    </mesh>
  );
}

/** A few degrees of tilt following the pointer. Not a turntable: a dashboard
 *  element that rotates on its own is movement in the corner of your eye all
 *  day, and this one only moves when you are looking at it. */
function Parallax({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);

  useFrame(({ pointer }) => {
    if (!group.current) return;
    const targetY = pointer.x * 0.22;
    const targetX = -pointer.y * 0.1;
    group.current.rotation.y += (targetY - group.current.rotation.y) * 0.08;
    group.current.rotation.x += (targetX - group.current.rotation.x) * 0.08;
  });

  return <group ref={group}>{children}</group>;
}

// ——— The machines ————————————————————————————————————————————————————————————

/** GMKtec M6 Ultra: a squat square chassis, perforated top, the round power
 *  button and the port row on the front, heat-sink fins out the right flank.
 *  The hotspot keys match mini-pc-flat.tsx exactly. */
function MiniPc({ hotspots, colors }: { hotspots: Record<string, HotspotState>; colors: ToneColors }) {
  const pattern = meshPattern();
  useEffect(() => {
    pattern.repeat.set(14, 14);
  }, [pattern]);

  return (
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
  );
}

/** UGREEN DXP4800 Pro: an upright tower, four bay doors down the front, the
 *  status LED above them, the fan on the right flank. Empty bays stay dark, and
 *  that is the point — three unlit bays next to a single-member array is the
 *  storage story in one glance. */
function Nas({ hotspots, colors }: { hotspots: Record<string, HotspotState>; colors: ToneColors }) {
  const pattern = meshPattern();
  useEffect(() => {
    pattern.repeat.set(10, 10);
  }, [pattern]);

  const bayY = [0.86, 0.29, -0.28, -0.85];

  return (
    <group>
      <mesh>
        <boxGeometry args={[1.35, 2.5, 1.9]} />
        <meshStandardMaterial color={CHASSIS} roughness={0.55} metalness={0.4} />
      </mesh>

      {/* Front face. */}
      <mesh position={[0, 0, 0.952]}>
        <planeGeometry args={[1.31, 2.46]} />
        <meshStandardMaterial color={CHASSIS_DARK} roughness={0.72} metalness={0.18} />
      </mesh>

      {bayY.map((y, i) => (
        <group key={i}>
          <mesh position={[0, y, 0.962]}>
            <planeGeometry args={[1.08, 0.5]} />
            <meshStandardMaterial map={pattern} color="#585d66" roughness={0.92} metalness={0.06} />
          </mesh>
          {/* The handle slot: without it the doors read as four stickers. */}
          <mesh position={[0.4, y, 0.968]}>
            <planeGeometry args={[0.16, 0.3]} />
            <meshStandardMaterial color={PANEL} roughness={0.95} />
          </mesh>
          {/* No halo on the bay lamps: four sprites stacked this close blur into
              one bar and the individual bays stop being readable. */}
          <Lamp
            hotspot={hotspots[`bay${i}`]}
            colors={colors}
            position={[-0.42, y, 0.972]}
            radius={0.035}
            halo={0}
          />
        </group>
      ))}

      <Lamp hotspot={hotspots.led} colors={colors} position={[0, 1.13, 0.965]} radius={0.05} halo={0.34} />

      {/* Fan on the right flank, warming with the hottest sensor. */}
      <mesh position={[0.953, 0.35, 0]} rotation={[0, Math.PI / 2, 0]}>
        <circleGeometry args={[0.6, 28]} />
        <meshStandardMaterial map={pattern} color="#4a4f58" roughness={0.95} />
      </mesh>
      <Panel
        hotspot={hotspots.fan}
        colors={colors}
        position={[0.958, 0.35, 0]}
        rotation={[0, Math.PI / 2, 0]}
        args={[1.02, 1.02]}
        floor={0.04}
        ceiling={0.42}
      />

      <Lamp hotspot={hotspots.nic0} colors={colors} position={[0.958, -0.62, 0.32]} rotation={[0, Math.PI / 2, 0]} radius={0.04} halo={0.26} />

      {[-0.5, 0.5].map((x) =>
        [-0.7, 0.7].map((z) => (
          <mesh key={`${x}:${z}`} position={[x, -1.27, z]}>
            <cylinderGeometry args={[0.07, 0.07, 0.05, 8]} />
            <meshStandardMaterial color={PANEL} roughness={0.95} />
          </mesh>
        )),
      )}
    </group>
  );
}

// ——— The canvas ——————————————————————————————————————————————————————————————

const VIEW = {
  homelab: { position: [2.9, 2.1, 3.5] as [number, number, number], target: 0, shadowY: -0.34, shadowSize: 5 },
  nas: { position: [3.1, 1.5, 3.9] as [number, number, number], target: 0, shadowY: -1.29, shadowSize: 6 },
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
