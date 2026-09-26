import type { TopoLink, Topology } from "@wire";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
// Shipped with three itself, so this is a deeper import and not a new
// dependency. Hand-rolling an orbit camera is eighty lines of spherical
// arithmetic plus the touch handling, and this one is already correct.
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FrameDriver, useActive } from "@/components/three/loop";
import { MiniPc, Nas, Router, SmartPlug } from "@/components/three/machines";
import { ContactShadow } from "@/components/three/parts";
import { useSceneColors, type SceneColors } from "@/components/three/webgl";
import type { Focus } from "@/components/topology/panels";
import {
  estateBounds,
  estateCentre,
  linkGeometry,
  NODE_AT,
  NODE_SCALE,
  SITE_FLOOR,
  type Marker,
  type SiteFloor,
  type Vec3,
} from "@/components/topology/layout";
import { cn } from "@/lib/utils";

// The estate in WebGL: two floor slabs, the hardware standing on them, and the
// paths between them.
//
// Built to the same rules as the hero scene — see components/three/parts.tsx —
// with two tightened for a canvas that fills the page rather than a card:
// dpr caps at 1.5 rather than 1.75, and the pointer parallax is halved, because
// there is a great deal more on screen to swing about.
//
// What this scene does *not* do is decide anything. Which links animate, how
// fast, and which are simply still all come out of the payload. A link with
// `rate: null` and no `cadenceS` has nothing measuring it and gets no motion at
// all, which is the difference between this and a screensaver.

/** Where the camera starts, and what "reset the view" means. */
/** The direction the camera looks from. The distance is not here on purpose —
 *  it is computed from the viewport, below.
 *
 *  About 38 degrees above the floor. There is a real trade here and it does not
 *  go the way it first looks: tilting further down makes the estate's depth
 *  project taller, which sounds like it fills a tall frame better but instead
 *  makes the *vertical* extent the binding constraint, so the fit pulls the
 *  camera back and everything ends up smaller. Low enough that width is what
 *  limits the framing, high enough that both floors read as floors. */
const HOME_DIRECTION = new THREE.Vector3(0, 0.64, 0.83).normalize();

const MAX_BEADS = 24;
/** How long one pulled scrape takes to cross its link. Fixed rather than
 *  stretched over the interval: a bead crawling for sixty seconds reads as a
 *  stream, and the whole point is that a scrape is a discrete event. */
const TRAVEL_S = 1.5;

/** Lit by hand, as the hero is. The key comes from the front left so both
 *  chassis faces are read first, and the cool fill keeps the far flat from
 *  merging into the page behind it. */
function Lights() {
  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[4, 7, 6]} intensity={2.1} color="#fff4e8" />
      <directionalLight position={[-6, 3, -5]} intensity={0.95} color="#9fc4ff" />
      {/* A soft fill straight down the camera axis. Without it every face
          turned towards the reader — which is where all the lamps and all the
          bay doors are — is lit by ambient alone and reads as black. */}
      <directionalLight position={[0, 1.5, 8]} intensity={0.55} color="#ffffff" />
    </>
  );
}

/** A house: four walls and a pitched roof, as two buffers.
 *
 *  Built by hand rather than from box and cone primitives because a gable is not
 *  a primitive, and because two geometries — one triangle soup for the glass,
 *  one line list for the arrises — is two draw calls for a whole building. The
 *  alternative, a mesh per wall plus an `edgesGeometry` on each, is fourteen.
 *
 *  Nothing here is wound consistently: the shell is `DoubleSide` and unlit, so
 *  which way a triangle faces changes nothing about how it paints. */
function houseGeometry(w: number, d: number, wall: number, roof: number) {
  const hw = w / 2;
  const hd = d / 2;
  const apex = wall + roof;

  // Eaves corners, then the two ends of the ridge. The ridge runs along x, the
  // long axis of both flats, so the gables face the short walls.
  const a: Vec3 = [-hw, 0, -hd];
  const b: Vec3 = [hw, 0, -hd];
  const c: Vec3 = [hw, 0, hd];
  const e: Vec3 = [-hw, 0, hd];
  const A: Vec3 = [-hw, wall, -hd];
  const B: Vec3 = [hw, wall, -hd];
  const C: Vec3 = [hw, wall, hd];
  const E: Vec3 = [-hw, wall, hd];
  const P: Vec3 = [-hw, apex, 0];
  const Q: Vec3 = [hw, apex, 0];

  const faces: number[] = [];
  const tri = (p: Vec3, q: Vec3, r: Vec3) => faces.push(...p, ...q, ...r);
  const quad = (p: Vec3, q: Vec3, r: Vec3, t: Vec3) => {
    tri(p, q, r);
    tri(p, r, t);
  };

  quad(a, b, B, A); // back wall
  quad(e, c, C, E); // front wall
  quad(a, e, E, A); // left wall
  quad(b, c, C, B); // right wall
  quad(A, B, Q, P); // roof, back slope
  quad(E, C, Q, P); // roof, front slope
  tri(A, E, P); // gable, left
  tri(B, C, Q); // gable, right

  const lines: number[] = [];
  const seg = (p: Vec3, q: Vec3) => lines.push(...p, ...q);
  for (const [p, q] of [
    [a, b],
    [b, c],
    [c, e],
    [e, a], // the slab
    [a, A],
    [b, B],
    [c, C],
    [e, E], // the corners
    [A, B],
    [B, C],
    [C, E],
    [E, A], // the eaves
    [P, Q], // the ridge
    [A, P],
    [E, P],
    [B, Q],
    [C, Q], // the rakes
  ] as [Vec3, Vec3][]) {
    seg(p, q);
  }

  const shell = new THREE.BufferGeometry();
  shell.setAttribute("position", new THREE.Float32BufferAttribute(faces, 3));
  const edges = new THREE.BufferGeometry();
  edges.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  return { shell, edges };
}

/** One flat: the floor it stands on, and the house around it.
 *
 *  Glass rather than plaster, and that is the whole trick. Solid walls would
 *  hide whichever machine was behind them from this angle — which is why this
 *  used to be a bare wireframe box, and why a bare wireframe box never read as a
 *  building. A face at six per cent catches just enough light to say "there is a
 *  surface here" while the hardware inside stays perfectly legible through it.
 *
 *  `depthWrite` is off on both the glass and its arrises: they are drawn after
 *  the opaque machines, and a transparent surface that writes depth punches a
 *  hole in everything queued behind it. */
function House({ floor, colors }: { floor: SiteFloor; colors: SceneColors }) {
  const [w, d] = floor.size;
  const { shell, edges } = useMemo(() => houseGeometry(w, d, floor.wall, floor.roof), [w, d, floor.wall, floor.roof]);
  useEffect(
    () => () => {
      shell.dispose();
      edges.dispose();
    },
    [shell, edges],
  );

  return (
    <group position={[floor.center[0], 0, floor.center[1]]}>
      {/* Unlit on purpose. A standard material here takes the key, the fill and
          the ambient all at once and clips to white whatever token it was given,
          which is how the floors came out the same pale grey in both themes —
          dark mode was the only reason it was noticed. A basic material paints
          exactly `--muted`, so the floor is the token and stays it. */}
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[w, 0.1, d]} />
        <meshBasicMaterial color={colors.surface} transparent opacity={0.54} toneMapped={false} />
      </mesh>
      <mesh geometry={shell} renderOrder={3}>
        <meshBasicMaterial
          color={colors.outline}
          transparent
          opacity={0.035}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <lineSegments geometry={edges} renderOrder={4}>
        <lineBasicMaterial color={colors.outline} transparent opacity={0.22} depthWrite={false} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

/** Site names are printed into the slab, not floated as another UI chip. A
 * single canvas texture per house is cheaper and calmer than DOM overlays that
 * follow the camera alongside device labels. */
function FloorStamp({ floor, label, colors }: { floor: SiteFloor; label: string; colors: SceneColors }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.font = "600 42px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.letterSpacing = "9px";
    context.fillStyle = "white";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label.toUpperCase(), canvas.width / 2, canvas.height / 2);
    const out = new THREE.CanvasTexture(canvas);
    out.colorSpace = THREE.SRGBColorSpace;
    return out;
  }, [label]);
  useEffect(() => () => texture?.dispose(), [texture]);

  if (!texture) return null;
  const [w, d] = floor.size;
  return (
    <mesh position={[floor.center[0], 0.012, floor.center[1] + d * 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w * 0.62, 0.52]} />
      <meshBasicMaterial map={texture} color={colors.outline} transparent opacity={0.28} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** The Cloudflare edge: a ring, because it is the one node with no chassis.
 *
 *  It is not a box and drawing it as one would claim more than is known — what
 *  is on the other side of that hostname is somebody else's fleet. A ring the
 *  log path threads through is the honest amount of detail. */
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

/** The people on the far side of Cloudflare.
 *
 *  A wireframe globe, and deliberately the only thing in the scene with no
 *  surface at all: everything else here is a machine someone in this estate
 *  owns, and this is not one. It carries no status because there is nothing to
 *  know — a viewer is not up or down, they either turned up or they did not. */
function Viewer({ at, colour }: { at: Vec3; colour: string }) {
  return (
    <mesh position={at} rotation={[0.3, 0.4, 0]}>
      <sphereGeometry args={[0.3, 12, 8]} />
      <meshBasicMaterial color={colour} wireframe transparent opacity={0.4} toneMapped={false} />
    </mesh>
  );
}

function curveOf(from: Vec3, control: Vec3, to: Vec3): THREE.QuadraticBezierCurve3 {
  return new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(...from),
    new THREE.Vector3(...control),
    new THREE.Vector3(...to),
  );
}

/** A link, as a tube.
 *
 *  A path nothing measures is drawn thinner and dimmer and carries no beads. It
 *  is deliberately not drawn as "quiet traffic": the flat renderer dashes it and
 *  this one dims it, and both mean the same thing — there is no number here. */
function Conduit({
  link,
  curve,
  colour,
  active,
}: {
  link: TopoLink;
  curve: THREE.QuadraticBezierCurve3;
  colour: string;
  active: boolean;
}) {
  const measured = link.status !== "unconfigured";
  // The two inter-flat routes are the thesis. Local wiring remains discoverable
  // without competing with the traffic that can actually isolate an outage.
  const primary = link.via !== undefined || link.transport === "tailnet" || link.transport === "tunnel";
  const geometry = useMemo(
    () => new THREE.TubeGeometry(curve, 44, active ? 0.052 : primary ? 0.038 : measured ? 0.024 : 0.014, 6, false),
    [curve, measured, primary, active],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  // The head sits at three quarters of the way along rather than the middle,
  // because the middle is where the link's own label floats.
  const head = useMemo(() => {
    const at = curve.getPoint(0.75);
    const along = curve.getTangent(0.75).normalize();
    // A cone points up the y axis; turn that axis onto the tangent.
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along);
    return { at, turn };
  }, [curve]);

  const opacity = active ? 0.98 : link.status === "down" ? 0.24 : primary ? 0.76 : measured ? 0.38 : 0.16;

  return (
    <>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={colour} transparent opacity={opacity} toneMapped={false} />
      </mesh>
      {/* Which way round the path runs. This is *not* motion, and it is drawn on
          the unmeasured links too, which is the distinction the rest of the page
          turns on: who dials whom is a fact about the configuration and is known
          even when the rate is not. The beads say how much is moving; the head
          says which end started it. */}
      <mesh position={head.at} quaternion={head.turn}>
        <coneGeometry args={[measured ? 0.085 : 0.06, measured ? 0.22 : 0.16, 10]} />
        <meshBasicMaterial color={colour} transparent opacity={opacity + 0.2} toneMapped={false} />
      </mesh>
    </>
  );
}

type BeadPlan = {
  id: string;
  curve: THREE.QuadraticBezierCurve3;
  colour: THREE.Color;
  /** Continuous flow: how many beads are in transit at once, and how long each
   *  takes end to end. */
  count: number;
  periodS: number;
  /** A poll instead of a flow: one bead, once per this many seconds. */
  cadenceS: number | null;
};

/** How much motion a link has earned, from its own numbers and nothing else.
 *
 *  A cadence is a fact about the scrape config, so a pulled link fires exactly
 *  one bead per interval. A rate is a measurement, so a pushed link runs a flow
 *  whose density and speed come from it — logarithmically, because the
 *  difference between idle and busy matters and the difference between busy and
 *  slightly busier does not. */
function planBeads(link: TopoLink, curve: THREE.QuadraticBezierCurve3, colour: string): BeadPlan | null {
  if (link.status === "down" || link.status === "unconfigured") return null;

  const shade = new THREE.Color(colour);

  if (link.cadenceS !== undefined) {
    return {
      id: link.id,
      curve,
      colour: shade,
      count: 1,
      periodS: TRAVEL_S,
      cadenceS: link.cadenceS,
    };
  }

  if (!link.rate || link.rate.value <= 0) return null;

  // Two scales, because the two measured flows are not in the same units: lines
  // per second for the log push, bytes per second for the wire.
  const magnitude =
    link.rate.unit === "count"
      ? Math.log1p(link.rate.value) / Math.log1p(200)
      : Math.log1p(link.rate.value * 8) / Math.log1p(2.5e9);
  const scaled = Math.max(0, Math.min(1, magnitude));

  return {
    id: link.id,
    curve,
    colour: shade,
    count: Math.max(1, Math.round(1 + scaled * 5)),
    periodS: 3.4 - scaled * 2.2,
    cadenceS: null,
  };
}

/** Every bead on the page, in one instanced mesh.
 *
 *  A mesh per bead would be a draw call per bead and this scene is already
 *  carrying two machines, two routers and a plug. Instances that are not in
 *  flight are scaled to zero rather than removed, so the buffer never resizes. */
function Beads({ plans, focus }: { plans: BeadPlan[]; focus: Focus }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const point = useMemo(() => new THREE.Vector3(), []);

  // Colours change only when the payload does, so they are written once here
  // rather than every frame with the matrices.
  useEffect(() => {
    const target = mesh.current;
    if (!target) return;
    let i = 0;
    for (const plan of plans) {
      for (let n = 0; n < plan.count && i < MAX_BEADS; n += 1, i += 1) {
        target.setColorAt(i, plan.colour);
      }
    }
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
  }, [plans]);

  useFrame(({ clock }) => {
    const target = mesh.current;
    if (!target) return;
    const t = clock.elapsedTime;
    let i = 0;

    for (const plan of plans) {
      const emphasised = focus?.kind === "link" && focus.id === plan.id;
      for (let n = 0; n < plan.count && i < MAX_BEADS; n += 1, i += 1) {
        let progress: number;

        if (plan.cadenceS !== null) {
          // One transfer per interval: it crosses, then the link is empty until
          // the next scrape is due. The empty stretch is the information.
          const phase = t % plan.cadenceS;
          progress = phase / Math.min(plan.periodS, plan.cadenceS);
        } else {
          progress = (t / plan.periodS + n / plan.count) % 1;
        }

        if (progress > 1) {
          dummy.scale.setScalar(0);
        } else {
          plan.curve.getPoint(progress, point);
          dummy.position.copy(point);
          // Fade in and out at the ends so a bead does not pop into existence on
          // top of the machine it came from.
          const edge = Math.min(1, Math.min(progress, 1 - progress) * 8);
          dummy.scale.setScalar((emphasised ? 0.115 : 0.085) * edge);
        }

        dummy.updateMatrix();
        target.setMatrixAt(i, dummy.matrix);
      }
    }

    for (; i < MAX_BEADS; i += 1) {
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      target.setMatrixAt(i, dummy.matrix);
    }

    target.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_BEADS]} frustumCulled={false}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/** One selected resource gets a slow, physical locator rather than a flashing
 * outline. It stays in world space, so it remains attached while orbiting. */
function FocusLock({ focus, curves, colour }: { focus: Focus; curves: Map<string, THREE.QuadraticBezierCurve3>; colour: string }) {
  const ring = useRef<THREE.Group>(null);
  const at = useMemo(() => {
    if (!focus) return null;
    if (focus.kind === "node") return NODE_AT[focus.id];
    return curves.get(focus.id)?.getPoint(0.5).toArray() as Vec3 | undefined;
  }, [focus, curves]);

  useFrame(({ clock }) => {
    if (!ring.current) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 2.1) * 0.07;
    ring.current.scale.setScalar(pulse);
    ring.current.rotation.y = clock.elapsedTime * 0.45;
  });

  if (!at) return null;
  return (
    <group ref={ring} position={at}>
      {/* A narrow mast makes selection readable at a glance, even when the
          resource itself is partly hidden by a floor or another machine. */}
      <mesh position={[0, 0.58, 0]}>
        <cylinderGeometry args={[0.009, 0.009, 1.16, 8]} />
        <meshBasicMaterial color={colour} transparent opacity={0.5} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.38, 0.018, 8, 36]} />
        <meshBasicMaterial color={colour} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, Math.PI / 4]}>
        <torusGeometry args={[0.5, 0.01, 6, 24]} />
        <meshBasicMaterial color={colour} transparent opacity={0.28} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Puts the HTML markers where their things are.
 *
 *  Labels and hit targets are DOM rather than sprites: sharper, themable from
 *  the same tokens, selectable, focusable, and — the part that matters — they
 *  are the hover and keyboard targets, so the picture needs no raycasting at all
 *  and the flat renderer can reuse the same interaction.
 *
 *  It lives inside the parallax group and reads that group's world matrix, so a
 *  marker stays glued to its device while the scene tilts. Nothing here touches
 *  React state: a re-render per frame at 30 fps would cost more than the scene. */
function Projector({ markers, elements }: { markers: Marker[]; elements: RefObject<Map<string, HTMLElement>> }) {
  const group = useRef<THREE.Group>(null);
  const v = useMemo(() => new THREE.Vector3(), []);
  const size = useThree((s) => s.size);

  useFrame(({ camera }) => {
    const root = group.current;
    if (!root) return;

    for (const marker of markers) {
      const el = elements.current.get(`${marker.kind}:${marker.id}`);
      if (!el) continue;
      v.set(marker.at[0], marker.at[1], marker.at[2]).applyMatrix4(root.matrixWorld).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -50%)`;
      // Revealed only once it has somewhere real to be. Until the lazy chunk has
      // loaded and the first frame has run, a marker has no position, and the
      // whole set would flash in the top-left corner on the way in.
      if (el.style.opacity !== "1") el.style.opacity = "1";
    }
  });

  return <group ref={group} />;
}

/** Drag to orbit, wheel or pinch to zoom, and nothing else.
 *
 *  Panning is off deliberately: with a fixed subject and no way back except a
 *  button, free panning mostly loses the estate off the side of the frame.
 *  The polar angle stops just above the horizon so the camera cannot get under
 *  the floors and look up through them, and the distance is clamped so zooming
 *  out cannot shrink the estate to a speck.
 *
 *  This replaces the pointer parallax the hero uses. The two cannot coexist —
 *  a scene that tilts toward the pointer *and* rotates under a drag fights
 *  itself — and once the camera is yours to move, having it drift on its own is
 *  the worse of the two. The hero keeps the parallax; it has no controls. */
/** The distance at which the whole estate fits the frame, exactly.
 *
 *  A fixed camera position cannot do this. The field of view is vertical, so a
 *  taller canvas *narrows* what is visible horizontally — making the picture
 *  fill the page therefore zoomed it in and pushed both flats off the sides,
 *  which is the opposite of what more room should buy. And the estate is a wide,
 *  shallow slab, so fitting it to a bounding sphere over-frames it vertically
 *  and leaves half the height empty.
 *
 *  So: take the eight corners of the estate's box, put each one in camera space
 *  at the current orientation, and solve for the smallest distance that keeps
 *  every one of them inside both frustum planes. */
function fitDistance(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  /** From the target towards the camera — the direction it will sit in, not the
   *  one it happens to be in while this is being worked out. */
  offset: THREE.Vector3,
  margin = 1.03,
): number {
  const { min, max } = estateBounds();

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
        // |lateral| <= (D + depth) * tan  =>  D >= |lateral| / tan - depth
        distance = Math.max(distance, Math.abs(v.dot(right)) / tanH - depth, Math.abs(v.dot(up)) / tanV - depth);
      }
    }
  }

  return distance * margin;
}

/** Frames the estate, and re-frames it whenever the canvas changes shape —
 *  until the reader takes the camera, at which point it stops interfering. */
function FitView({ enabled, api }: { enabled: boolean; api: RefObject<OrbitControls | null> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  useEffect(() => {
    if (!enabled) return;
    const target = new THREE.Vector3(...estateCentre());
    camera.position.copy(target).addScaledVector(HOME_DIRECTION, fitDistance(camera, target, HOME_DIRECTION));
    camera.lookAt(target);
    const controls = api.current;
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
  }, [enabled, camera, size.width, size.height, api]);

  return null;
}

function Controls({
  onInteract,
  api,
}: {
  onInteract: (interacting: boolean) => void;
  api: RefObject<OrbitControls | null>;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const notify = useRef(onInteract);
  notify.current = onInteract;

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(...estateCentre());
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.enablePan = false;
    controls.minDistance = 7;
    controls.maxDistance = 34;
    controls.minPolarAngle = 0.15;
    // Just shy of the horizon: below it the camera is under the floors.
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 1.1;
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
  }, [camera, gl, api]);

  // Damping needs a frame after the pointer stops; the display-smooth driver
  // provides it whenever the canvas is on screen and in front.
  useFrame(() => api.current?.update());

  return null;
}

export default function TopologyScene({
  topology,
  markers,
  elements,
  focus,
  selected,
  className,
}: {
  topology: Topology;
  markers: Marker[];
  elements: RefObject<Map<string, HTMLElement>>;
  focus: Focus;
  selected: Focus;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const active = useActive(host);
  const colors = useSceneColors();
  const controls = useRef<OrbitControls | null>(null);
  const [moved, setMoved] = useState(false);

  // `moved` is sticky and drives the reset button — offered only once the view
  // is no longer the one the page chose, because a reset on an unmoved camera
  // is a control that does nothing.
  const onInteract = useCallback((active: boolean) => {
    if (active) setMoved(true);
  }, []);

  // Reset just hands the camera back to FitView, which re-frames for whatever
  // shape the canvas is now — rather than restoring a position that was right
  // for the window the page happened to load in.
  const reset = useCallback(() => setMoved(false), []);

  // Keyed on the *shape* of the graph, not on the payload.
  //
  // The page re-polls every five seconds, so memoising on `topology` would
  // rebuild every tube geometry four times a minute for numbers that do not move
  // a single vertex. The arrangement only changes when a link is added, removed
  // or re-routed, and this signature is exactly that.
  const shape = topology.links.map((l) => `${l.id}:${l.from}>${l.to}${l.via ?? ""}`).join("|");

  const curves = useMemo(() => {
    const out = new Map<string, THREE.QuadraticBezierCurve3>();
    for (const [id, g] of linkGeometry(topology)) out.set(id, curveOf(g.from, g.control, g.to));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  const plans = useMemo(() => {
    const out: BeadPlan[] = [];
    for (const link of topology.links) {
      const curve = curves.get(link.id);
      if (!curve) continue;
      const plan = planBeads(link, curve, colors.transport[link.transport]);
      if (plan) out.push(plan);
    }
    return out;
  }, [topology.links, curves, colors.transport]);

  const byId = useMemo(() => new Map(topology.nodes.map((n) => [n.id, n])), [topology.nodes]);
  const homelab = byId.get("homelab");
  const nas = byId.get("nas");
  const plug = byId.get("plug");
  const cinemaEdge = byId.get("cinema-edge");
  const viewer = byId.get("viewer");
  const proton = byId.get("proton");

  return (
    <div ref={host} className={cn("relative h-full w-full", className)}>
      <Canvas
        frameloop="never"
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        camera={{ position: [0, 9, 16], fov: 33 }}
      >
        {/* Beads carry live traffic. Keep their cadence at display smoothness;
            visibility still stops all work when this canvas is offscreen. */}
        <FrameDriver active={active} fps={60} />
        <Lights />
        <Controls onInteract={onInteract} api={controls} />
        <FitView enabled={!moved} api={controls} />

        <group>
          <FloorStamp floor={SITE_FLOOR.davide} label="Davide's flat" colors={colors} />
          <FloorStamp floor={SITE_FLOOR.ilario} label="Ilario's flat" colors={colors} />
          <House floor={SITE_FLOOR.davide} colors={colors} />
          <House floor={SITE_FLOOR.ilario} colors={colors} />

          {homelab && (
            <MiniPc
              hotspots={homelab.hotspots ?? {}}
              colors={colors.tone}
              position={NODE_AT.homelab}
              scale={NODE_SCALE.homelab}
              rotation={[0, 0.45, 0]}
            />
          )}
          {nas && (
            <Nas
              hotspots={nas.hotspots ?? {}}
              colors={colors.tone}
              position={NODE_AT.nas}
              scale={NODE_SCALE.nas}
              rotation={[0, 0.12, 0]}
            />
          )}
          {plug && (
            <SmartPlug
              hotspots={{
                // The plug has one light and one number, so its hotspot is made
                // here rather than shipped: everything the server computes is a
                // mapping several things share, and this is not one of those.
                plug: {
                  level: plug.status === "up" ? 0.85 : 0.1,
                  tone: plug.status === "up" ? "good" : "bad",
                  pulse: plug.status === "up" ? 0.25 : 0,
                  label: "Plug",
                  value: plug.metrics[0]?.display ?? "—",
                },
              }}
              colors={colors.tone}
              position={NODE_AT.plug}
              scale={NODE_SCALE.plug}
              rotation={[0, 0.3, 0]}
            />
          )}
          <Router position={NODE_AT.fritzbox} scale={NODE_SCALE.fritzbox} rotation={[0, 0.2, 0]} />
          <Router position={NODE_AT["nas-router"]} scale={NODE_SCALE["nas-router"]} rotation={[0, -0.3, 0]} />
          <Edge at={NODE_AT.edge!} colour={colors.transport.tunnel} />
          {/* The NAS's own tunnel, and whoever is on the other end of it. Two
              rings rather than one: they are two tunnels with two credentials,
              and only one of them has any evidence behind it. */}
          {cinemaEdge && <Edge at={NODE_AT["cinema-edge"]!} colour={colors.transport.tunnel} />}
          {viewer && <Viewer at={NODE_AT.viewer!} colour={colors.transport.internet} />}
          {/* The torrent exit. A ring like the other two tunnels, because that is
              what it is -- one more outbound-dialled tunnel, this one WireGuard. */}
          {proton && <Edge at={NODE_AT.proton!} colour={colors.transport.tunnel} />}

          <ContactShadow x={NODE_AT.homelab![0]} z={NODE_AT.homelab![2]} y={0.012} size={3} opacity={0.5} />
          <ContactShadow x={NODE_AT.nas![0]} z={NODE_AT.nas![2]} y={0.012} size={3} opacity={0.5} />

          {topology.links.map((link) => {
            const curve = curves.get(link.id);
            if (!curve) return null;
            return (
              <Conduit
                key={link.id}
                link={link}
                curve={curve}
                colour={colors.transport[link.transport]}
                active={focus?.kind === "link" && focus.id === link.id}
              />
            );
          })}

          <Beads plans={plans} focus={focus} />
          <FocusLock
            focus={selected}
            curves={curves}
            colour={
              selected?.kind === "link"
                ? colors.transport[topology.links.find((link) => link.id === selected.id)?.transport ?? "lan"]
                : colors.tone.accent
            }
          />

          <Projector markers={markers} elements={elements} />
        </group>
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
