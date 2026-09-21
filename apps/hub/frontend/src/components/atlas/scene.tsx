import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AtlasFloor, AtlasItem, Vec3 } from "@/components/atlas/model";
import { FrameDriver, useActive } from "@/components/three/loop";
import { MiniPc, Nas, Router, SmartPlug } from "@/components/three/machines";
import { glow } from "@/components/three/materials";
import { ContactShadow } from "@/components/three/parts";
import { NODE_SCALE } from "@/components/topology/layout";
import { useSceneColors, type SceneColors } from "@/components/three/webgl";
import { cn } from "@/lib/utils";

// The estate again, with what runs on it.
//
// Same rules as the topology scene: no CDN assets, no shadow maps, labels are
// DOM projected from here, and a token only pulses when its status is bad or
// something measured is actually busy. An idle healthy service sits still.

const HOME = new THREE.Vector3(0, 0.62, 0.86).normalize();

const ROTATION: Record<string, [number, number, number]> = {
  homelab: [0, 0.45, 0],
  nas: [0, 0.12, 0],
  plug: [0, 0.3, 0],
  fritzbox: [0, 0.2, 0],
  "nas-router": [0, -0.3, 0],
};

function Lights() {
  return (
    <>
      <ambientLight intensity={0.88} />
      <directionalLight position={[4, 7, 6]} intensity={2.05} color="#fff4e8" />
      <directionalLight position={[-6, 3, -5]} intensity={0.9} color="#9fc4ff" />
      <directionalLight position={[0, 1.5, 8]} intensity={0.55} color="#ffffff" />
    </>
  );
}

function Slab({ floor, fill, rim }: { floor: AtlasFloor; fill: string; rim: string }) {
  const [w, d] = floor.size;
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, d)), [w, d]);
  useEffect(() => () => edges.dispose(), [edges]);

  return (
    <group position={[floor.center[0], 0, floor.center[1]]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={fill} roughness={1} metalness={0} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={rim} transparent opacity={0.7} />
      </lineSegments>
    </group>
  );
}

function FloorName({ floor, color }: { floor: AtlasFloor; color: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.font = "600 42px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.letterSpacing = "8px";
    context.fillStyle = "white";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(floor.label.toUpperCase(), canvas.width / 2, canvas.height / 2);
    const out = new THREE.CanvasTexture(canvas);
    out.colorSpace = THREE.SRGBColorSpace;
    return out;
  }, [floor.label]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  const [w, d] = floor.size;
  return (
    <mesh position={[floor.center[0], 0.02, floor.center[1] + d * 0.28]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w * 0.55, 0.42]} />
      <meshBasicMaterial map={texture} color={color} transparent opacity={0.32} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function Edge({ at, colour }: { at: Vec3; colour: string }) {
  return (
    <group position={at} rotation={[0.35, 0, 0]}>
      <mesh>
        <torusGeometry args={[0.42, 0.035, 8, 32]} />
        <meshBasicMaterial color={colour} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <mesh>
        <circleGeometry args={[0.42, 24]} />
        <meshBasicMaterial color={colour} transparent opacity={0.12} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Viewer({ at, colour }: { at: Vec3; colour: string }) {
  return (
    <mesh position={at} rotation={[0.3, 0.4, 0]}>
      <sphereGeometry args={[0.3, 12, 8]} />
      <meshBasicMaterial color={colour} wireframe transparent opacity={0.4} toneMapped={false} />
    </mesh>
  );
}

function Token({ item, color, hot }: { item: AtlasItem; color: string; hot: boolean }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const aura = useRef<THREE.SpriteMaterial>(null);
  const radius = item.kind === "service" ? 0.16 : 0.1;
  const halo = item.tone === "bad" || item.tone === "warn";

  useFrame(({ clock }) => {
    const wave = item.pulse > 0 ? 0.55 + 0.45 * Math.sin(clock.elapsedTime * item.pulse * Math.PI * 2) : 1;
    const intensity = (hot ? 0.9 : 0.38) * wave;
    if (mat.current) mat.current.emissiveIntensity = intensity;
    if (aura.current) aura.current.opacity = Math.min(0.85, intensity);
  });

  return (
    <group position={item.at}>
      <mesh>
        <cylinderGeometry args={[radius, radius * 0.86, 0.05, 24]} />
        <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={0.4} roughness={0.32} metalness={0.2} />
      </mesh>
      {halo && (
        <sprite scale={[0.7, 0.7, 1]} position={[0, 0.02, 0]}>
          <spriteMaterial
            ref={aura}
            map={glow()}
            color={color}
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

function Hardware({ item, colors, hot }: { item: AtlasItem; colors: SceneColors; hot: boolean }) {
  const position = item.at;
  const scale = NODE_SCALE[item.id] ?? 0.8;
  const rotation = ROTATION[item.id];
  const tone = colors.tone[item.tone];

  if (item.id === "homelab") {
    return <MiniPc hotspots={item.hotspots ?? {}} colors={colors.tone} position={position} scale={scale} rotation={rotation} />;
  }
  if (item.id === "nas") {
    return <Nas hotspots={item.hotspots ?? {}} colors={colors.tone} position={position} scale={scale} rotation={rotation} />;
  }
  if (item.id === "plug") {
    return <SmartPlug hotspots={item.hotspots ?? {}} colors={colors.tone} position={position} scale={scale} rotation={rotation} />;
  }
  if (item.id === "fritzbox" || item.id === "nas-router") {
    return <Router position={position} scale={scale} rotation={rotation} />;
  }
  if (item.id === "viewer") return <Viewer at={position} colour={colors.transport.internet} />;
  if (item.kind === "device") return <Edge at={position} colour={hot ? colors.tone.accent : colors.transport.tunnel} />;
  return <Token item={item} color={tone} hot={hot} />;
}

function Stems({ items, color }: { items: AtlasItem[]; color: string }) {
  const geom = useMemo(() => {
    const pos: number[] = [];
    for (const item of items) {
      if (!item.anchorAt) continue;
      const fromY = Math.min(item.at[1] - 0.15, item.anchorAt[1] + 0.35);
      pos.push(item.anchorAt[0], fromY, item.anchorAt[2], item.at[0], item.at[1], item.at[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [items]);
  useEffect(() => () => geom.dispose(), [geom]);
  if ((geom.getAttribute("position")?.count ?? 0) === 0) return null;
  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial color={color} transparent opacity={0.38} />
    </lineSegments>
  );
}

function Orbits({ items, color }: { items: AtlasItem[]; color: string }) {
  const rings = useMemo(() => {
    const seen = new Set<string>();
    const out: { x: number; z: number; r: number }[] = [];
    for (const item of items) {
      if (!item.anchorAt || item.orbit == null || item.orbit <= 0) continue;
      const key = `${item.anchor}:${item.orbit.toFixed(2)}`;
      if (seen.has(key)) continue;
      const count = items.filter((other) => other.anchor === item.anchor && other.orbit === item.orbit).length;
      if (count < 2) continue;
      seen.add(key);
      out.push({ x: item.anchorAt[0], z: item.anchorAt[2], r: item.orbit });
    }
    return out;
  }, [items]);

  return (
    <>
      {rings.map((ring) => (
        <mesh key={`${ring.x}:${ring.z}:${ring.r}`} position={[ring.x, 0.025, ring.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[ring.r, 0.012, 8, 72]} />
          <meshBasicMaterial color={color} transparent opacity={0.28} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

function Projector({
  items,
  elements,
}: {
  items: AtlasItem[];
  elements: RefObject<Map<string, HTMLElement>>;
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const size = useThree((s) => s.size);

  useFrame(({ camera }) => {
    for (const item of items) {
      const el = elements.current.get(`${item.kind}:${item.id}`);
      if (!el) continue;
      v.set(item.at[0], item.at[1] + (item.kind === "device" ? 0.55 : 0.22), item.at[2]).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      const behind = v.z > 1;
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -120%)`;
      el.style.opacity = behind ? "0" : "1";
      el.style.pointerEvents = behind ? "none" : "";
    }
  });

  return null;
}

function fitDistance(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  offset: THREE.Vector3,
  min: Vec3,
  max: Vec3,
): number {
  const forward = offset.clone().negate().normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const tanV = Math.tan(((camera.fov / 2) * Math.PI) / 180);
  const tanH = tanV * camera.aspect;
  const v = new THREE.Vector3();
  let distance = 0;
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        v.set(x, y, z).sub(target);
        const depth = v.dot(forward);
        distance = Math.max(distance, Math.abs(v.dot(right)) / tanH - depth, Math.abs(v.dot(up)) / tanV - depth);
      }
    }
  }
  return distance * 1.06;
}

function centreOf(min: Vec3, max: Vec3): THREE.Vector3 {
  return new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
}

function FitView({
  enabled,
  api,
  bounds,
}: {
  enabled: boolean;
  api: RefObject<OrbitControls | null>;
  bounds: { min: Vec3; max: Vec3 };
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const sig = `${bounds.min.join()}|${bounds.max.join()}|${size.width}|${size.height}`;

  useEffect(() => {
    if (!enabled) return;
    const target = centreOf(bounds.min, bounds.max);
    camera.position.copy(target).addScaledVector(HOME, fitDistance(camera, target, HOME, bounds.min, bounds.max));
    camera.lookAt(target);
    const controls = api.current;
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
    // `sig` is the bounds and the canvas size. The object identity is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, camera, api, sig]);

  return null;
}

function Controls({
  onInteract,
  api,
  bounds,
}: {
  onInteract: (interacting: boolean) => void;
  api: RefObject<OrbitControls | null>;
  bounds: { min: Vec3; max: Vec3 };
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const notify = useRef(onInteract);
  notify.current = onInteract;
  const sig = `${bounds.min.join()}|${bounds.max.join()}`;

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.copy(centreOf(bounds.min, bounds.max));
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.enablePan = false;
    controls.minDistance = 6;
    controls.maxDistance = 38;
    controls.minPolarAngle = 0.18;
    controls.maxPolarAngle = Math.PI / 2 - 0.06;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 1.05;
    controls.update();

    const started = () => notify.current(true);
    const ended = () => notify.current(false);
    controls.addEventListener("start", started);
    controls.addEventListener("end", ended);
    api.current = controls;
    return () => {
      controls.removeEventListener("start", started);
      controls.removeEventListener("end", ended);
      controls.dispose();
      api.current = null;
    };
    // `sig` is the estate box. Rebuilding controls on a new bounds object would
    // throw away a drag that had only just started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl, api, sig]);

  useFrame(() => api.current?.update());
  return null;
}

function hot(item: AtlasItem, focusId: string | null, focusAnchor: string | null): boolean {
  if (!focusId) return false;
  if (item.id === focusId) return true;
  if (item.anchor && item.anchor === focusId) return true;
  if (focusAnchor && item.id === focusAnchor) return true;
  return false;
}

export default function AtlasScene({
  items,
  floors,
  bounds,
  focusId,
  focusAnchor,
  elements,
  className,
}: {
  items: AtlasItem[];
  floors: AtlasFloor[];
  bounds: { min: Vec3; max: Vec3 };
  focusId: string | null;
  focusAnchor: string | null;
  elements: RefObject<Map<string, HTMLElement>>;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const active = useActive(host);
  const colors = useSceneColors();
  const controls = useRef<OrbitControls | null>(null);
  const [moved, setMoved] = useState(false);

  function reset() {
    setMoved(false);
  }

  return (
    <div ref={host} className={cn("absolute inset-0", className)}>
      <Canvas
        frameloop="never"
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 9, 16], fov: 32 }}
      >
        <FrameDriver active={active} fps={30} />
        <Lights />
        <Controls onInteract={setMoved} api={controls} bounds={bounds} />
        <FitView enabled={!moved} api={controls} bounds={bounds} />

        {floors.map((floor) => (
          <group key={floor.id}>
            <Slab floor={floor} fill={colors.surface} rim={colors.tone[floor.tone]} />
            <FloorName floor={floor} color={colors.outline} />
          </group>
        ))}

        <Orbits items={items} color={colors.outline} />
        <Stems items={items} color={colors.outline} />

        {items.map((item) => (
          <Hardware key={`${item.kind}:${item.id}`} item={item} colors={colors} hot={hot(item, focusId, focusAnchor)} />
        ))}

        <Shadows items={items} />

        <Projector items={items} elements={elements} />
      </Canvas>

      {moved && (
        <button
          type="button"
          onClick={reset}
          className={cn(
            "bg-card/85 border-border text-muted-foreground hover:text-foreground absolute right-3 bottom-3 z-10",
            "focus-visible:ring-ring/60 rounded-full border px-2.5 py-1 text-[11px]",
            "transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
          )}
        >
          Reset view
        </button>
      )}
    </div>
  );
}

function Shadows({ items }: { items: AtlasItem[] }) {
  return (
    <>
      {(["homelab", "nas"] as const).map((id) => {
        const item = items.find((entry) => entry.id === id);
        if (!item) return null;
        return <ContactShadow key={id} x={item.at[0]} z={item.at[2]} y={0.012} size={id === "nas" ? 2.8 : 2.6} opacity={0.45} />;
      })}
    </>
  );
}
