import type {
  ContainerDetail,
  ContainersResponse,
  HotspotState,
  MediaNode,
  MediaPipeline,
  Status,
  Tone,
  Topology,
  TopoNode,
} from "@wire";
import { HEALTH_TONE, STATUS_TONE } from "@/components/primitives";
import { NODE_AT, SITE_FLOOR, type Vec3 } from "@/components/topology/layout";

// What the Atlas picture is made of.
//
// Topology already answers "which path". This answers "what is running, and on
// which machine". Devices keep the positions the estate already uses, so the
// two pages are the same rooms. Services and containers are new: they orbit
// the machine they actually run on, and a container that is already a named
// service is not drawn twice.
//
// The ring is capped. A halo of every container stops being a picture and
// becomes a pile of labels. The ones left out stay in the list — the cap is a
// drawing decision, not a filter on the data.

export type { Vec3 };

export type AtlasKind = "device" | "service" | "container";
export type AtlasLayer = "all" | "devices" | "services" | "containers";
export type AtlasFocus = { kind: AtlasKind; id: string } | null;

export type AtlasStat = {
  label: string;
  value: string;
  tone?: Tone;
  fraction?: number;
};

export type AtlasItem = {
  kind: AtlasKind;
  id: string;
  label: string;
  role: string;
  status: Status;
  /** Printed in place of the generic status word, when the source has a better one. */
  statusText?: string;
  tone: Tone;
  at: Vec3;
  /** False for containers that lost the draw — they stay in the list only. */
  placed: boolean;
  site: "davide" | "ilario" | "cloud";
  anchor?: string;
  anchorAt?: Vec3;
  /** Floor radius of the orbit this token sits on. Absent for devices. */
  orbit?: number;
  pulse: number;
  stats: AtlasStat[];
  addresses: { value: string; kind: string }[];
  /** Activity rows, ports, flags that are on. Printed under the numbers. */
  lines: string[];
  note?: string;
  href?: string;
  alerts: string[];
  hotspots?: Record<string, HotspotState>;
};

export type AtlasFloor = {
  id: "davide" | "ilario";
  label: string;
  center: [number, number];
  size: [number, number];
  tone: Tone;
};

export type AtlasModel = {
  items: AtlasItem[];
  floors: AtlasFloor[];
  /** Stable: floors and devices, not the rings, so a poll cannot yank the camera. */
  bounds: { min: Vec3; max: Vec3 };
  /** Set when the ring is a subset of the containers. */
  containerNote: string | null;
};

const RING_CAP = 10;

const HREF: Record<string, string> = {
  homelab: "/overview",
  plug: "/power",
  nas: "/nas",
  fritzbox: "/network",
  "nas-router": "/network",
  edge: "/logs",
  "cinema-edge": "/logs",
  viewer: "/media",
};

function claimed(name: string, ids: Set<string>): boolean {
  const n = name.toLowerCase();
  for (const id of ids) {
    if (n === id || n.startsWith(`${id}-`) || n.startsWith(`${id}_`)) return true;
  }
  return false;
}

function ring(origin: Vec3, count: number, radius: number, y: number, phase: number): Vec3[] {
  return Array.from({ length: count }, (_, i) => {
    const a = phase + (i / count) * Math.PI * 2;
    return [origin[0] + Math.cos(a) * radius, y, origin[2] + Math.sin(a) * radius] as Vec3;
  });
}

function radiusFor(count: number, full: number): number {
  if (count <= 1) return full * 0.7;
  if (count <= 4) return full * 0.84;
  return full;
}

function containerStatus(c: ContainerDetail): Status {
  if (c.health === "unhealthy" || c.state === "dead") return "down";
  if (c.state === "restarting" || c.state === "paused" || c.health === "starting") return "warn";
  if (c.state === "running") return "up";
  if (c.state === "exited") return "down";
  return "unconfigured";
}

/** Unhealthy and busy first, so the cap keeps the containers worth seeing. */
function interest(c: ContainerDetail): number {
  const failing = c.health === "unhealthy" || c.state === "dead" || c.state === "restarting" ? 1000 : 0;
  const running = c.state === "running" ? 100 : 0;
  return failing + running + (c.cpuPercent ?? 0);
}

function pulseFor(status: Status, busy: boolean): number {
  if (status === "down") return 1.3;
  if (status === "warn") return 0.8;
  if (busy) return 0.4;
  return 0;
}

function deviceOf(node: TopoNode): AtlasItem {
  const at = NODE_AT[node.id] ?? [0, 0.2, 0];
  const hotspots =
    node.hotspots ??
    (node.id === "plug"
      ? {
          plug: {
            level: node.status === "up" ? 0.85 : 0.1,
            tone: node.status === "up" ? "good" : "bad",
            pulse: node.status === "up" ? 0.25 : 0,
            label: "Plug",
            value: node.metrics[0]?.display ?? "—",
          },
        }
      : undefined);

  return {
    kind: "device",
    id: node.id,
    label: node.label,
    role: node.role,
    status: node.status,
    tone: STATUS_TONE[node.status],
    at,
    placed: true,
    site: node.site,
    pulse: node.status === "down" ? 1.3 : node.status === "warn" ? 0.8 : 0,
    stats: node.metrics.slice(0, 6).map((m) => ({
      label: m.label,
      value: m.display,
      tone: HEALTH_TONE[m.health],
      fraction: m.fraction,
    })),
    addresses: node.addresses.map((a) => ({ value: a.value, kind: a.kind })),
    lines: [],
    note: node.note,
    href: node.href ?? HREF[node.id],
    alerts: node.alerts,
    hotspots,
  };
}

function hostOf(node: MediaNode): string {
  try {
    return new URL(node.link).host;
  } catch {
    return node.link;
  }
}

function serviceOf(node: MediaNode, at: Vec3, anchorAt: Vec3, orbit: number): AtlasItem {
  const stats: AtlasStat[] = node.stats.slice(0, 4).map((s) => ({
    label: s.label,
    value: s.value,
    tone: s.tone,
    fraction: s.fraction,
  }));
  if (node.load) {
    stats.unshift({
      label: "CPU",
      value: `${node.load.cpuPercent.toFixed(1)}%`,
      tone: node.load.cpuPercent > 50 ? "warn" : "accent",
      fraction: Math.min(1, node.load.cpuPercent / 100),
    });
    stats.splice(1, 0, { label: "Memory", value: node.load.rssDisplay });
  }
  if (node.latencyMs != null) stats.push({ label: "Round trip", value: `${Math.round(node.latencyMs)} ms` });

  const busy = node.activity.length > 0 || (node.load?.cpuPercent ?? 0) > 20;

  return {
    kind: "service",
    id: node.id,
    label: node.label,
    role: node.version ? `${node.role} · ${node.version}` : node.role,
    status: node.status,
    tone: STATUS_TONE[node.status],
    at,
    placed: true,
    site: "davide",
    anchor: "homelab",
    anchorAt,
    orbit,
    pulse: pulseFor(node.status, busy),
    stats,
    addresses: [{ value: hostOf(node), kind: "public" }],
    lines: [
      ...node.flags.filter((f) => f.on).map((f) => f.label),
      ...node.activity.slice(0, 3).map((a) => (a.subtitle ? `${a.title} — ${a.subtitle}` : a.title)),
    ],
    note: node.error,
    href: "/media",
    alerts: [],
  };
}

function shortImage(image: string): string {
  const bare = image.split("/").pop() ?? image;
  return bare.length > 48 ? `${bare.slice(0, 46)}…` : bare;
}

function containerOf(c: ContainerDetail, at: Vec3 | null, anchorAt: Vec3, orbit: number): AtlasItem {
  const status = containerStatus(c);
  const stats: AtlasStat[] = [
    {
      label: "CPU",
      value: c.cpuPercent === null ? "—" : `${c.cpuPercent.toFixed(1)}%`,
      tone: (c.cpuPercent ?? 0) > 50 ? "warn" : "accent",
      fraction: c.cpuPercent === null ? undefined : Math.min(1, c.cpuPercent / 100),
    },
    { label: "Memory", value: c.rssDisplay },
  ];
  const where = c.compose ? `${c.compose.project} / ${c.compose.service}` : c.instance;
  return {
    kind: "container",
    id: `${c.instance}:${c.id}`,
    label: c.name,
    role: c.status || where,
    status,
    statusText: c.status,
    tone: STATUS_TONE[status],
    at: at ?? anchorAt,
    placed: at !== null,
    site: c.instance === "nas" ? "ilario" : "davide",
    anchor: c.instance === "nas" ? "nas" : "homelab",
    anchorAt,
    orbit: at ? orbit : undefined,
    pulse: pulseFor(status, (c.cpuPercent ?? 0) > 20),
    stats,
    addresses: [],
    lines: [where, shortImage(c.image), ...c.ports.slice(0, 3)],
    href: "/containers",
    alerts: [],
  };
}

function worst(tones: Status[]): Tone {
  if (tones.includes("down")) return "bad";
  if (tones.includes("warn")) return "warn";
  if (tones.length > 0 && tones.every((s) => s === "unconfigured")) return "default";
  if (tones.includes("up")) return "good";
  return "default";
}

function placeContainers(
  rows: ContainerDetail[],
  origin: Vec3,
  taken: Set<string>,
): { placed: AtlasItem[]; rest: AtlasItem[] } {
  const mine = rows.filter((c) => !claimed(c.name, taken));
  const chosen = [...mine].sort((a, b) => interest(b) - interest(a) || a.name.localeCompare(b.name)).slice(0, RING_CAP);
  // Slot by name, not by busyness, so a poll that reorders CPU does not shuffle the ring.
  chosen.sort((a, b) => a.name.localeCompare(b.name));
  const orbit = radiusFor(chosen.length, 2.35);
  const spots = ring(origin, chosen.length, orbit, 0.92, -Math.PI / 2 + Math.PI / Math.max(chosen.length, 1));
  const chosenIds = new Set(chosen.map((c) => c.id));
  const placed = chosen.map((c, i) => containerOf(c, spots[i]!, origin, orbit));
  const rest = mine.filter((c) => !chosenIds.has(c.id)).map((c) => containerOf(c, null, origin, orbit));
  return { placed, rest };
}

export function buildAtlas(
  topology: Topology,
  media: MediaPipeline | null,
  containers: ContainersResponse | null,
): AtlasModel {
  const devices = topology.nodes.filter((n) => NODE_AT[n.id]).map(deviceOf);
  const byId = new Map(devices.map((d) => [d.id, d]));
  const homelab = byId.get("homelab");
  const nas = byId.get("nas");

  const services: AtlasItem[] = [];
  const taken = new Set<string>();
  if (homelab && media) {
    const nodes = media.nodes.filter((n) => n.kind === "service");
    const orbit = radiusFor(nodes.length, 1.8);
    const spots = ring(homelab.at, nodes.length, orbit, 1.42, -Math.PI / 2);
    nodes.forEach((node, i) => {
      taken.add(node.id.toLowerCase());
      taken.add(node.label.toLowerCase());
      services.push(serviceOf(node, spots[i]!, homelab.at, orbit));
    });
  }

  const rows = containers?.containers ?? [];
  const onBox = placeContainers(
    rows.filter((c) => c.instance === "homelab"),
    homelab?.at ?? NODE_AT.homelab!,
    taken,
  );
  const onNas = placeContainers(
    rows.filter((c) => c.instance === "nas"),
    nas?.at ?? NODE_AT.nas!,
    taken,
  );

  const items = [...devices, ...services, ...onBox.placed, ...onNas.placed, ...onBox.rest, ...onNas.rest];

  const floors: AtlasFloor[] = (["davide", "ilario"] as const).map((id) => {
    const floor = SITE_FLOOR[id];
    const site = topology.sites.find((s) => s.id === id);
    const here = devices.filter((d) => d.site === id).map((d) => d.status);
    return {
      id,
      label: site?.label ?? id,
      center: floor.center,
      size: floor.size,
      tone: worst(here),
    };
  });

  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (p: Vec3) => {
    min = [Math.min(min[0], p[0]), Math.min(min[1], p[1]), Math.min(min[2], p[2])];
    max = [Math.max(max[0], p[0]), Math.max(max[1], p[1]), Math.max(max[2], p[2])];
  };
  for (const floor of floors) {
    const [cx, cz] = floor.center;
    const [w, d] = floor.size;
    grow([cx - w / 2 - 1.4, 0, cz - d / 2 - 1.4]);
    grow([cx + w / 2 + 1.4, 2.4, cz + d / 2 + 1.4]);
  }
  for (const device of devices) grow(device.at);

  const drawn = onBox.placed.length + onNas.placed.length;
  const total = onBox.placed.length + onBox.rest.length + onNas.placed.length + onNas.rest.length;
  const containerNote =
    drawn < total
      ? `${drawn} of ${total} containers are drawn — the unhealthy ones and the busiest. The rest stay in the list.`
      : null;

  return { items, floors, bounds: { min, max }, containerNote };
}

function matches(item: AtlasItem, q: string): boolean {
  return `${item.label} ${item.role} ${item.note ?? ""} ${item.lines.join(" ")}`.toLowerCase().includes(q);
}

/** Rows in the list. A search looks through every kind; the layer is the browse default. */
export function isListed(item: AtlasItem, layer: AtlasLayer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q) return matches(item, q);
  if (layer === "devices") return item.kind === "device";
  if (layer === "services") return item.kind === "service";
  if (layer === "containers") return item.kind === "container";
  return true;
}

/** What the picture draws. The machine stays up when its ring is the subject,
 *  so a service filter does not leave tokens floating with nothing under them. */
export function isDrawn(item: AtlasItem, layer: AtlasLayer, query: string, items: AtlasItem[]): boolean {
  if (!item.placed) return false;
  const q = query.trim().toLowerCase();
  if (q) {
    if (matches(item, q)) return true;
    return item.kind === "device" && items.some((other) => other.placed && other.anchor === item.id && matches(other, q));
  }
  if (layer === "all") return true;
  if (layer === "devices") return item.kind === "device";
  const want: AtlasKind = layer === "services" ? "service" : "container";
  if (item.kind === want) return true;
  return item.kind === "device" && items.some((other) => other.placed && other.anchor === item.id && other.kind === want);
}
