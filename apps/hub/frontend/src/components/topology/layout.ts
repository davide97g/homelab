import type { Topology } from "@wire";

// Where everything stands, in one place.
//
// These are world coordinates: x across, y up, z towards the viewer, with the
// two flats sitting either side of x = 0 and the Cloudflare edge floating in the
// gap above them. The WebGL scene uses them directly. The flat SVG projects them
// through `iso()` below, which is the whole reason they live here rather than in
// the scene: two renderers arranged by hand would drift apart the first time a
// node moved, and then the phone would be showing a different estate.
//
// The arrangement is the argument the page is making. Davide's flat on the left
// holds everything that does the monitoring; Ilario's on the right holds the one
// machine being monitored; and the span between them is where every interesting
// failure lives.

export type Vec3 = [number, number, number];

export const NODE_AT: Record<string, Vec3> = {
  // Spread rather than clustered. Every node carries a label and every link
  // carries one at its midpoint, so nodes packed two units apart produce a pile
  // of chips nobody can read — the arrangement has to leave room for the writing.
  homelab: [-4.6, 0.21, 2.8],
  plug: [-2.0, 0.21, 3.8],
  fritzbox: [-7.2, 0.08, 1.0],
  nas: [3.2, 0.4, -1.2],
  "nas-router": [6.1, 0.08, -3.0],
  edge: [0.2, 3.2, 0.4],
  // The two cloud nodes sit above the flat whose traffic they carry, not in a
  // neutral strip: the logs edge over the span between the flats because it
  // belongs to both ends of that path, and the cinema edge over Ilario's roof
  // because that tunnel starts and ends there. `viewer` hangs off to the right,
  // outside both houses, which is the whole point of it.
  "cinema-edge": [4.7, 3.3, -0.5],
  viewer: [7.2, 2.55, 1.1],
  // ProtonVPN, above the far left of Davide's flat: the torrent exit belongs to
  // that flat's box and nothing else, so it floats over it rather than in the
  // span between the flats where the shared paths are. The link to it bends
  // through the FRITZ!Box, which is the wire it really leaves by.
  proton: [-6.5, 3.05, -0.9],
};

/** Scale per node kind, so one set of world positions places geometry that was
 *  modelled at wildly different sizes — the NAS is 2.5 units tall on its own. */
export const NODE_SCALE: Record<string, number> = {
  homelab: 0.62,
  plug: 0.62,
  fritzbox: 0.95,
  nas: 0.5,
  "nas-router": 0.95,
  edge: 1,
  "cinema-edge": 1,
  viewer: 1,
  proton: 1,
};

/** A flat: where it is, how big it is, and the house drawn around it.
 *
 *  `wall` and `roof` are what turn the old outlined box into a building. They
 *  are not to scale with the hardware and cannot be — a mini PC is 4 cm tall and
 *  a ceiling is 2.7 m, and at the true ratio the machines would be specks on a
 *  parade ground. They are sized so the rooms read as rooms and the devices
 *  inside them stay the subject. */
export type SiteFloor = {
  center: [number, number];
  size: [number, number];
  /** Wall height, from the slab to the eaves. */
  wall: number;
  /** Ridge height, from the eaves to the apex. The ridge runs along x. */
  roof: number;
};

/** The two flats are offset in depth as well as across.
 *
 *  Side by side they read as two rooms of one building, which is the one thing
 *  they are not — they are on different physical networks in different places,
 *  and the only reason the NAS is reachable at all is a tailnet. Setting them
 *  apart diagonally says "somewhere else" without pretending to be a map, and it
 *  gives a very wide, very shallow scene something to fill its height with. */
export const SITE_FLOOR: Record<"davide" | "ilario", SiteFloor> = {
  davide: { center: [-4.4, 1.9], size: [7.8, 5.6], wall: 0.8, roof: 1.1 },
  ilario: { center: [4.5, -2.4], size: [5.6, 5.2], wall: 0.72, roof: 0.95 },
};

/** The lift on a link's control point. The span between the flats arcs high
 *  because it leaves the ground in reality too; a link inside one room barely
 *  bends, because it does not. */
const LIFT: Record<string, number> = {
  "pull-nas": 0.9,
  "pull-plug": 0.35,
  "lan-uplink": 0.35,
  cinema: 0.15,
};

/** A link as a quadratic bezier: two ends and one control point.
 *
 *  `via` is not decoration. The log push really does go out to Cloudflare and
 *  back, so that link is drawn as one curve bent through the edge node rather
 *  than two straight segments — it is one decision by one Alloy instance, and
 *  splitting it would imply two independent hops that can fail separately. */
export function controlPoint(from: Vec3, to: Vec3, linkId: string, via?: Vec3): Vec3 {
  if (via) return via;
  const lift = LIFT[linkId] ?? 0.4;
  return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + lift, (from[2] + to[2]) / 2];
}

/** A point on that curve. Used by the beads in WebGL and by the SVG path in the
 *  flat renderer, so a bead and a dash sit in the same place in both. */
export function bezier(from: Vec3, control: Vec3, to: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return [
    u * u * from[0] + 2 * u * t * control[0] + t * t * to[0],
    u * u * from[1] + 2 * u * t * control[1] + t * t * to[1],
    u * u * from[2] + 2 * u * t * control[2] + t * t * to[2],
  ];
}

// ——— The flat projection ————————————————————————————————————————————————————

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

/** World to SVG. A plain isometric cabinet projection: no perspective, no
 *  camera, and the same axes as the scene, so the two renderers agree about
 *  what is left of what. */
export function iso([x, y, z]: Vec3, scale = 34): [number, number] {
  return [(x - z) * COS30 * scale, ((x + z) * SIN30 - y * 1.25) * scale];
}

/** Everything the renderers need about one link, resolved once. */
export type LinkGeometry = { from: Vec3; control: Vec3; to: Vec3 };

export function linkGeometry(topology: Topology): Map<string, LinkGeometry> {
  const out = new Map<string, LinkGeometry>();
  for (const link of topology.links) {
    const from = NODE_AT[link.from];
    const to = NODE_AT[link.to];
    // A link naming a node this layout has never heard of is skipped rather than
    // drawn at the origin, where it would look like a real edge into nowhere.
    if (!from || !to) continue;
    const via = link.via ? NODE_AT[link.via] : undefined;
    out.set(link.id, {
      from,
      control: controlPoint(from, to, link.id, via),
      to,
    });
  }
  return out;
}

// ——— Markers ————————————————————————————————————————————————————————————————

/** How far above a node its label floats, by node id. Enough to clear the
 *  geometry and not so much that the label stops belonging to the thing. */
const LABEL_LIFT: Record<string, number> = {
  "cinema-edge": 0.45,
  viewer: 0.5,
  homelab: 0.85,
  plug: 0.62,
  fritzbox: 0.55,
  nas: 0.8,
  "nas-router": 0.55,
  edge: 0.45,
  proton: 0.45,
};

/** A label, which is also the hit target.
 *
 *  The WebGL scene projects these every frame and the flat renderer places them by
 *  the same isometric projection it draws with, so hovering the same thing means
 *  the same thing in both. Node-link pictures are usually reachable only with a
 *  pointer; making the labels the targets is what buys tab and Enter for free. */
export type Marker = {
  id: string;
  kind: "node" | "link";
  at: Vec3;
  /** Whether this marker states its number without being asked.
   *
   *  Six nodes and five links is eleven chips over a picture that is mostly
   *  empty floor, and at equal weight they both collide into an unreadable pile
   *  and bury the two links the page exists to show.
   *
   *  So a link that crosses between the flats always carries its rate, and the
   *  three inside one room shrink to a dot until pointed at. Nothing is hidden:
   *  a dot is still a hit target, still in the tab order, and the ledger reaches
   *  every node either way. */
  prominent: boolean;
};

export function markersOf(topology: Topology): Marker[] {
  const out: Marker[] = [];
  const siteOf = new Map(topology.nodes.map((n) => [n.id, n.site]));

  for (const node of topology.nodes) {
    const at = NODE_AT[node.id];
    if (!at) continue;
    out.push({
      id: node.id,
      kind: "node",
      at: [at[0], at[1] + (LABEL_LIFT[node.id] ?? 0.6), at[2]],
      prominent: true,
    });
  }

  const geometry = linkGeometry(topology);
  for (const link of topology.links) {
    const g = geometry.get(link.id);
    if (!g) continue;
    // The midpoint of the curve rather than of the straight line, or a label
    // would sit well under the arc it belongs to, and lifted clear of it.
    const mid = bezier(g.from, g.control, g.to, 0.5);
    out.push({
      id: link.id,
      kind: "link",
      at: [mid[0], mid[1] + 0.42, mid[2]],
      prominent: siteOf.get(link.from) !== siteOf.get(link.to),
    });
  }

  return out;
}

/** The box everything lives in: both floors, every device, and the edge ring
 *  above them, with a margin for the labels that float over the top.
 *
 *  Derived rather than written down, so moving a node cannot silently leave the
 *  camera framing the wrong volume. */
export function estateBounds(): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, 0, Infinity];
  const max: Vec3 = [-Infinity, 0.6, -Infinity];

  const eat = (x: number, y: number, z: number) => {
    min[0] = Math.min(min[0], x);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  };

  for (const floor of Object.values(SITE_FLOOR)) {
    const [cx, cz] = floor.center;
    const [w, d] = floor.size;
    eat(cx - w / 2, floor.wall + floor.roof, cz - d / 2);
    eat(cx + w / 2, floor.wall + floor.roof, cz + d / 2);
  }

  for (const [id, at] of Object.entries(NODE_AT)) {
    eat(at[0], at[1] + (LABEL_LIFT[id] ?? 0.6) + 0.4, at[2]);
  }

  return { min, max };
}

/** The middle of that box, in all three axes.
 *
 *  Including the vertical one matters: the box runs from the floors up to the
 *  Cloudflare ring, so aiming at the floor plane hangs everything above the
 *  centre of the frame and leaves the empty half underneath. */
export function estateCentre(): Vec3 {
  const { min, max } = estateBounds();
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}
