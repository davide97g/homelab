import type { MediaNode, MediaPipeline, MediaStat, Status, VpnSnapshot } from "@wire";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  Box,
  Container,
  Download,
  Globe2,
  Home,
  Lock,
  LockOpen,
  Network,
  Radar,
  Router,
  Server,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { memo, useMemo, type ReactNode } from "react";
import { KillSwitch } from "@/components/media/kill-switch";
import { Viewport } from "@/components/media/viewport";
import { FieldLabel, StatusDot } from "@/components/primitives";
import { cn } from "@/lib/utils";

import "@xyflow/react/dist/style.css";

// The same stack as the pipeline, cut the other way: not "what talks to what"
// but "what is inside what, and who on the way out can see which address".
//
// Left to right is inside to outside. The boxes nest the way the isolation
// does — the mini PC holds the Docker network, which holds gluetun's network
// namespace, which is the only place qBittorrent has an interface. Two lanes
// leave the box through the same NIC, router and ISP: the sealed one is
// WireGuard, already encrypted before it touches the host, and ends at Proton;
// the plain one is everything else, and ends wherever it was going, from the
// home line. Each hop on the way says what it can see of each lane.
//
// The layout is fixed and lives here rather than on the server, unlike the
// pipeline's: nothing in it moves, and it draws facts about the network, not
// the services. The home address itself is never in the payload, so the page
// can only ever say "the home IP", which is the point.

// ——— Geometry ————————————————————————————————————————————————————————————————
//
// Every lane is a horizontal line: the tall hop cards put their handles at the
// two lane heights, and every other card is sized so its centre sits on one.

const TOP = -102;
const BOTTOM = 650;
const LANE = { sealed: 183, plain: 497 } as const;
const HOP = { y: 60, h: 560, w: 240 } as const;

type Rect = { x: number; y: number; w: number; h: number };

/** The boundaries, outermost first so they stack behind each other. */
const FRAMES: { id: string; label: string; sub: string; tone: FrameTone; icon: LucideIcon; rect: Rect }[] = [
  {
    id: "box",
    label: "mini PC · debian",
    sub: "the host: its own firewall in front of every container port",
    tone: "box",
    icon: Server,
    rect: { x: -60, y: TOP, w: 1060, h: BOTTOM - TOP },
  },
  {
    id: "docker",
    label: "Docker network · mediarr",
    sub: "a bridge the containers share; no route in from outside",
    tone: "docker",
    icon: Container,
    rect: { x: -30, y: -62, w: 680, h: 672 },
  },
  {
    id: "namespace",
    label: "gluetun network namespace",
    sub: "qBittorrent has no other network",
    tone: "namespace",
    icon: Lock,
    rect: { x: 0, y: -22, w: 620, h: 392 },
  },
  {
    id: "lan",
    label: "home network",
    sub: "",
    tone: "outside",
    icon: Home,
    rect: { x: 1040, y: TOP, w: 300, h: BOTTOM - TOP },
  },
  {
    id: "isp",
    label: "your ISP",
    sub: "",
    tone: "outside",
    icon: Network,
    rect: { x: 1380, y: TOP, w: 300, h: BOTTOM - TOP },
  },
  {
    id: "proton",
    label: "ProtonVPN",
    sub: "",
    tone: "outside",
    icon: Shield,
    rect: { x: 1720, y: TOP, w: 360, h: BOTTOM - TOP },
  },
  {
    id: "internet",
    label: "the internet",
    sub: "",
    tone: "outside",
    icon: Globe2,
    rect: { x: 2120, y: TOP, w: 320, h: BOTTOM - TOP },
  },
];

// ——— Nodes ————————————————————————————————————————————————————————————————————

type FrameTone = "box" | "docker" | "namespace" | "outside";
type FrameData = { label: string; sub: string; tone: FrameTone; icon: LucideIcon; w: number; h: number; cut: boolean };
type FrameNode = Node<FrameData, "frame">;

/** A boundary. Purely a picture: no handles, drawn behind its contents. */
const FrameView = memo(function FrameView({ data }: NodeProps<FrameNode>) {
  const { label, sub, tone, icon: Icon, w, h, cut } = data;
  return (
    <div
      aria-hidden
      style={{ width: w, height: h }}
      className={cn(
        "pointer-events-none relative rounded-2xl transition-colors duration-300",
        tone === "box" && "border-border bg-card/25 border",
        tone === "docker" && "border-primary/30 bg-primary/[0.025] border border-dashed",
        tone === "namespace" &&
          (cut
            ? "border-tone-bad/60 bg-tone-bad/[0.05] border-2 border-dashed"
            : "border-tone-accent/50 bg-tone-accent/[0.05] border-2 border-dashed"),
        tone === "outside" && "border-border/50 border border-dotted",
      )}
    >
      <div
        className={cn(
          "absolute top-2.5 left-3.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase",
          tone === "namespace" ? (cut ? "text-tone-bad" : "text-tone-accent") : "text-muted-foreground",
          tone === "docker" && "text-primary/80",
        )}
      >
        <Icon className="size-3" />
        {label}
      </div>
      {sub && (
        <p className="text-muted-foreground absolute right-3.5 bottom-2 left-3.5 truncate text-[9.5px]">{sub}</p>
      )}
    </div>
  );
});

type Row = { label: string; value: string; tone?: "good" | "bad" | "warn" | "accent" };

type CardData = {
  icon: LucideIcon;
  title: string;
  role: string;
  status?: Status;
  /** Painted as sealed (accent), plain, or cut. */
  lane: "sealed" | "plain" | "cut";
  rows: Row[];
  note?: string;
  extra?: ReactNode;
  w: number;
  h: number;
};
type CardNode = Node<CardData, "card">;

const TONE: Record<NonNullable<Row["tone"]>, string> = {
  good: "text-tone-good",
  bad: "text-tone-bad",
  warn: "text-tone-warn",
  accent: "text-tone-accent",
};

const handle = "!border-0 !bg-transparent";

/** A service or an endpoint: a few labelled facts, fixed size so its centre
 *  sits on its lane. */
const CardView = memo(function CardView({ data }: NodeProps<CardNode>) {
  const { icon: Icon, title, role, status, lane, rows, note, extra, w, h } = data;
  return (
    <div style={{ width: w, height: h }} className="neu flex flex-col overflow-hidden text-left">
      <Handle type="target" position={Position.Left} className={handle} />
      <Handle type="source" position={Position.Right} className={handle} />
      <Handle type="source" position={Position.Top} id="over" className={handle} />
      <Handle type="target" position={Position.Bottom} id="under" className={handle} />

      <header className="flex items-start gap-2 px-3 pt-3 pb-2">
        <Icon
          className={cn(
            "mt-px size-4 shrink-0",
            lane === "sealed" ? "text-tone-accent" : lane === "cut" ? "text-tone-bad" : "text-primary",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] leading-tight font-semibold">{title}</span>
            {status && <StatusDot status={status} />}
          </div>
          <p className="text-muted-foreground truncate text-[10px] leading-tight">{role}</p>
        </div>
      </header>

      <div className="border-border/60 grid gap-1.5 border-t px-3 py-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <FieldLabel className="shrink-0">{row.label}</FieldLabel>
            <span className={cn("tnum truncate font-mono text-[11px]", row.tone && TONE[row.tone])}>{row.value}</span>
          </div>
        ))}
      </div>

      {extra && <div className="border-border/60 border-t px-3 py-2.5">{extra}</div>}

      {note && (
        <p className="text-muted-foreground border-border/60 mt-auto border-t px-3 py-2 text-[10px] leading-snug">
          {note}
        </p>
      )}
    </div>
  );
});

type Sight = { sees: string; detail: string };
type HopData = {
  icon: LucideIcon;
  title: string;
  role: string;
  sealed: Sight;
  plain: Sight;
  cut: boolean;
};
type HopNode = Node<HopData, "hop">;

/** A piece of the way out that both lanes cross: the box's NIC, the router, the
 *  ISP. Split in two, one half per lane, each saying what this hop can see of
 *  it — which is the whole reason the view exists. */
const HopView = memo(function HopView({ data }: NodeProps<HopNode>) {
  const { icon: Icon, title, role, sealed, plain, cut } = data;
  const sealedTop = LANE.sealed - HOP.y;
  const plainTop = LANE.plain - HOP.y;
  return (
    <div style={{ width: HOP.w, height: HOP.h }} className="neu flex flex-col overflow-hidden text-left">
      <Handle type="target" id="sealed" position={Position.Left} style={{ top: sealedTop }} className={handle} />
      <Handle type="source" id="sealed" position={Position.Right} style={{ top: sealedTop }} className={handle} />
      <Handle type="target" id="plain" position={Position.Left} style={{ top: plainTop }} className={handle} />
      <Handle type="source" id="plain" position={Position.Right} style={{ top: plainTop }} className={handle} />

      <header className="flex items-start gap-2 px-3 pt-3 pb-2">
        <Icon className="text-primary mt-px size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-tight font-semibold">{title}</span>
          <p className="text-muted-foreground text-[10px] leading-tight">{role}</p>
        </div>
      </header>

      <Half lane={cut ? "cut" : "sealed"} sight={sealed} />
      <Half lane="plain" sight={plain} />
    </div>
  );
});

function Half({ lane, sight }: { lane: "sealed" | "plain" | "cut"; sight: Sight }) {
  const LaneIcon = lane === "plain" ? LockOpen : Lock;
  return (
    <div
      className={cn(
        "border-border/60 flex flex-1 flex-col justify-center gap-1.5 border-t px-3 py-3",
        lane === "sealed" && "bg-tone-accent/[0.06]",
        lane === "cut" && "bg-tone-bad/[0.06]",
      )}
    >
      <span
        className={cn(
          "flex items-center gap-1.5 text-[9.5px] font-medium tracking-[0.14em] uppercase",
          lane === "sealed" ? "text-tone-accent" : lane === "cut" ? "text-tone-bad" : "text-muted-foreground",
        )}
      >
        <LaneIcon className="size-3" />
        {lane === "plain" ? "home lane · sees" : lane === "cut" ? "sealed lane · cut" : "sealed lane · sees"}
      </span>
      <p className="text-[12px] leading-snug font-medium">{sight.sees}</p>
      <p className="text-muted-foreground text-[10.5px] leading-snug">{sight.detail}</p>
    </div>
  );
}

// ——— Edges ————————————————————————————————————————————————————————————————————

type LaneEdgeData = { lane: "sealed" | "plain" | "cut" | "inside"; active: boolean };
type LaneEdge = Edge<LaneEdgeData, "lane">;

/** The sealed lane is drawn as a tube with a line inside it: the tube is the
 *  WireGuard encryption, the line is the traffic it carries — so every hop it
 *  passes shows it arriving already wrapped. The plain lane is a bare line. */
const LaneEdgeView = memo(function LaneEdgeView(props: EdgeProps<LaneEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, markerEnd, data } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const lane = data?.lane ?? "plain";
  const active = data?.active ?? false;
  const colour =
    lane === "cut" ? "var(--tone-bad)" : lane === "plain" ? "var(--muted-foreground)" : "var(--tone-accent)";

  return (
    <>
      {(lane === "sealed" || lane === "cut") && (
        <path
          d={path}
          fill="none"
          stroke={colour}
          strokeWidth={16}
          strokeLinecap="round"
          opacity={lane === "cut" ? 0.14 : 0.3}
        />
      )}
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        style={{
          stroke: colour,
          strokeWidth: lane === "plain" ? 1.3 : 1.8,
          strokeDasharray: lane === "cut" ? "5 5" : active ? "6 6" : undefined,
          opacity: lane === "plain" ? 0.6 : 1,
          ...(active && lane !== "cut" ? { animation: "dashdraw 0.6s linear infinite" } : {}),
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <span
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={cn(
              "bg-card/95 absolute rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              lane === "cut" ? "text-tone-bad" : lane === "plain" ? "text-muted-foreground" : "text-tone-accent",
            )}
          >
            {label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const NODE_TYPES = { frame: FrameView, card: CardView, hop: HopView };
const EDGE_TYPES = { lane: LaneEdgeView };

// ——— Data ————————————————————————————————————————————————————————————————————

const stat = (node: MediaNode | undefined, id: string): MediaStat | undefined => node?.stats.find((s) => s.id === id);

function where(vpn: VpnSnapshot | null): string {
  return vpn?.exit ? [vpn.exit.city, vpn.exit.country].filter(Boolean).join(", ") : "—";
}

export default function NetworkGraph({ data, onChanged }: { data: MediaPipeline; onChanged: () => void }) {
  const vpn = data.vpn;
  const cut = vpn?.killSwitch ?? false;
  const running = vpn?.tunnel === "running";
  const sealed: LaneEdgeData["lane"] = cut || !running ? "cut" : "sealed";
  const moving = (vpn?.torrent?.downBytesPerSec ?? 0) + (vpn?.torrent?.upBytesPerSec ?? 0) > 0;

  const nodes = useMemo<Node[]>(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const qbit = byId.get("qbittorrent");
    const prowlarr = byId.get("prowlarr");
    const viaVpn = stat(prowlarr, "vpn");
    const t = vpn?.torrent ?? null;
    const home = ["jellyseerr", "radarr", "sonarr", "bazarr"].map((id) => byId.get(id)).filter(Boolean) as MediaNode[];
    const worst: Status = home.some((n) => n.status === "down")
      ? "down"
      : home.some((n) => n.status === "warn")
        ? "warn"
        : "up";

    const frames: Node[] = FRAMES.map((f) => ({
      id: `frame-${f.id}`,
      type: "frame",
      position: { x: f.rect.x, y: f.rect.y },
      data: { label: f.label, sub: f.sub, tone: f.tone, icon: f.icon, w: f.rect.w, h: f.rect.h, cut: cut || !running },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    }));

    const card = (id: string, x: number, y: number, card: CardData, interactive = false): Node => ({
      id,
      type: "card",
      position: { x, y },
      data: card,
      draggable: false,
      // React Flow gives a node that is neither draggable nor selectable
      // `pointer-events: none`; the kill switch has to receive its click.
      ...(interactive ? { style: { pointerEvents: "all" as const } } : {}),
    });

    const hop = (id: string, x: number, hopData: HopData): Node => ({
      id,
      type: "hop",
      position: { x, y: HOP.y },
      data: hopData,
      draggable: false,
    });

    return [
      ...frames,

      card("qbittorrent", 20, 40, {
        icon: Download,
        title: "qBittorrent",
        role: "joins gluetun's namespace; owns no interface",
        ...(qbit ? { status: qbit.status } : {}),
        lane: "sealed",
        w: 240,
        h: 190,
        rows: [
          { label: "Torrents", value: stat(qbit, "torrents")?.value ?? "—" },
          { label: "Bound to", value: t?.iface ?? "—", tone: t?.bound ? "good" : "bad" },
          { label: "Listening", value: t?.listenPort ? String(t.listenPort) : "—" },
          {
            label: "Seeding",
            value: stat(qbit, "seeding")?.value ?? "—",
            tone: stat(qbit, "seeding")?.value === "off" ? "good" : "warn",
          },
          { label: "↓ / ↑", value: `${stat(qbit, "down")?.value ?? "—"} / ${stat(qbit, "up")?.value ?? "—"}` },
        ],
      }),

      card(
        "gluetun",
        320,
        LANE.sealed - 165,
        {
          icon: Shield,
          title: "gluetun",
          role: "the namespace's only door out",
          ...(vpn ? { status: vpn.status } : {}),
          lane: cut || !running ? "cut" : "sealed",
          w: 280,
          h: 330,
          rows: [
            {
              label: "tun0 · WireGuard",
              value: cut ? "held down" : running ? "up" : "unknown",
              tone: running ? "good" : "bad",
            },
            { label: "Firewall", value: "tunnel only", tone: "good" },
            { label: "Forwarded port", value: vpn?.forwardedPort ? String(vpn.forwardedPort) : "none" },
            { label: "DNS", value: "DoT, in the tunnel" },
            { label: "IPv6", value: "blocked", tone: "good" },
            {
              label: "HTTP proxy :8888",
              value: viaVpn ? `${viaVpn.value} indexers` : "—",
              tone: viaVpn?.tone === "good" ? "good" : viaVpn?.tone === "bad" ? "bad" : undefined,
            },
          ],
          extra: <KillSwitch vpn={vpn} onChanged={onChanged} />,
        },
        true,
      ),

      card("prowlarr", 20, 400, {
        icon: Radar,
        title: "Prowlarr",
        role: "outside the namespace; borrows the tunnel",
        ...(prowlarr ? { status: prowlarr.status } : {}),
        lane: "sealed",
        w: 240,
        h: 170,
        rows: [
          {
            label: "Via VPN",
            value: viaVpn?.value ?? "—",
            tone: viaVpn?.tone === "good" ? "good" : viaVpn?.tone === "bad" ? "bad" : undefined,
          },
          { label: "Queries 24h", value: stat(prowlarr, "queries")?.value ?? "—" },
        ],
        note: "Indexers tagged vpn search through gluetun's proxy. App sync to Radarr and Sonarr stays on the bridge.",
      }),

      card("home", 320, LANE.plain - 85, {
        icon: Box,
        title: "Everything else",
        role: home.map((n) => n.label).join(" · ") || "Seerr · Radarr · Sonarr · Bazarr",
        status: worst,
        lane: "plain",
        w: 280,
        h: 170,
        rows: [
          { label: "Metadata", value: "Radarr · Sonarr · Seerr" },
          { label: "Subtitles", value: "Bazarr" },
          { label: "Public sites", value: "Cloudflare tunnels" },
        ],
      }),

      hop("uplink", 720, {
        icon: Server,
        title: "the box's uplink",
        role: "one NIC · UFW + DOCKER-USER",
        cut: cut || !running,
        sealed: {
          sees: cut ? "nothing — the tunnel is down" : "WireGuard packets, already sealed",
          detail: "gluetun encrypts before the host touches it. The only thing coming back in is what arrives through the tunnel.",
        },
        plain: {
          sees: "ordinary HTTPS, one per destination",
          detail: "Inbound allowed only from the LAN and your own tailnet devices. Nothing from the internet.",
        },
      }),

      hop("router", 1070, {
        icon: Router,
        title: "FRITZ!Box",
        role: "NAT · no port forwards · UPnP off",
        cut: cut || !running,
        sealed: {
          sees: cut || !running ? "nothing — the tunnel is down" : "one UDP flow to a Proton server",
          detail: "Every peer rides inside it, so the NAT table keeps one entry — the reason the house's Internet no longer dies.",
        },
        plain: {
          sees: "which hosts the box reaches",
          detail: "No inbound port is open on the home IP; the old 6881 forward is gone.",
        },
      }),

      hop("isp", 1410, {
        icon: Network,
        title: "your ISP",
        role: "the home IP lives here — never on this page",
        cut: cut || !running,
        sealed: {
          sees: cut || !running ? "nothing — the tunnel is down" : "encrypted traffic to Proton",
          detail: "Not the torrents, not the searches, not the DNS. Only that the box talks to a VPN.",
        },
        plain: {
          sees: "where the lookups go",
          detail: "Metadata servers, subtitle providers, Cloudflare. HTTPS hides what, not who.",
        },
      }),

      card("proton", 1750, LANE.sealed - 130, {
        icon: Shield,
        title: "ProtonVPN",
        role: vpn?.exit?.org ? `exit server · ${vpn.exit.org}` : "exit server",
        ...(vpn ? { status: vpn.status } : {}),
        lane: cut || !running ? "cut" : "sealed",
        w: 300,
        h: 260,
        rows: [
          { label: "Exit", value: cut ? "none" : where(vpn), tone: cut ? "bad" : "accent" },
          { label: "Exit IP", value: cut ? "—" : (vpn?.exit?.ip ?? "—") },
          { label: "Forwarded port", value: vpn?.forwardedPort ? String(vpn.forwardedPort) : "none" },
          {
            label: "Leak check",
            value: vpn?.leak.clean === true ? "clean" : vpn?.leak.clean === false ? "LEAKING" : "unchecked",
            tone: vpn?.leak.clean === true ? "good" : vpn?.leak.clean === false ? "bad" : "warn",
          },
        ],
        note: "The tunnel ends here. Proton is the one party that sees both ends — the home IP and the traffic.",
      }),

      card("swarm", 2150, LANE.sealed - 90, {
        icon: Globe2,
        title: "Swarm & indexers",
        role: "peers · trackers · DHT · Nyaa · TPB",
        lane: cut || !running ? "cut" : "sealed",
        w: 260,
        h: 180,
        rows: [
          { label: "They see", value: cut ? "nothing" : (vpn?.exit?.ip ?? "the Proton exit"), tone: "accent" },
          { label: "Located in", value: cut ? "—" : where(vpn) },
        ],
        note: cut ? "Kill switch held: nothing reaches them." : "Inbound peers reach qBittorrent on the forwarded port, through the tunnel.",
      }),

      card("web", 2150, LANE.plain - 90, {
        icon: Globe2,
        title: "Everyone else",
        role: "metadata · subtitles · Cloudflare",
        lane: "plain",
        w: 260,
        h: 180,
        rows: [{ label: "They see", value: "the home IP", tone: "warn" }],
        note: "Knows what is in the library, not what is being shared: nothing seeds.",
      }),
    ];
  }, [data.nodes, vpn, cut, running, onChanged]);

  const edges = useMemo<Edge[]>(() => {
    const e = (
      id: string,
      source: string,
      target: string,
      lane: LaneEdgeData["lane"],
      label?: string,
      handles: { sourceHandle?: string; targetHandle?: string } = {},
      active = false,
    ): Edge => ({
      id,
      source,
      target,
      type: "lane",
      ...handles,
      ...(label ? { label } : {}),
      data: { lane, active },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: lane === "cut" ? "var(--tone-bad)" : lane === "plain" ? "var(--muted-foreground)" : "var(--tone-accent)",
      },
    });
    const through = { sourceHandle: "sealed", targetHandle: "sealed" };
    const bare = { sourceHandle: "plain", targetHandle: "plain" };

    return [
      e("qbit-gluetun", "qbittorrent", "gluetun", "inside", "tun0", {}, moving),
      e("prowlarr-gluetun", "prowlarr", "gluetun", "inside", "proxy :8888", { sourceHandle: "over", targetHandle: "under" }),
      e("gluetun-uplink", "gluetun", "uplink", sealed, cut ? "cut · kill switch" : "WireGuard", { targetHandle: "sealed" }, moving),
      e("uplink-router", "uplink", "router", sealed, undefined, through, moving),
      e("router-isp", "router", "isp", sealed, undefined, through, moving),
      e("isp-proton", "isp", "proton", sealed, "sealed until here", { sourceHandle: "sealed" }, moving),
      e("proton-swarm", "proton", "swarm", sealed, cut ? "no exit" : "exit IP", {}, moving),

      e("home-uplink", "home", "uplink", "plain", "HTTPS", { targetHandle: "plain" }),
      e("uplink-router-plain", "uplink", "router", "plain", undefined, bare),
      e("router-isp-plain", "router", "isp", "plain", undefined, bare),
      e("isp-web", "isp", "web", "plain", "home IP · passes Proton by", { sourceHandle: "plain" }),
    ];
  }, [sealed, cut, moving]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
      minZoom={0.15}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      nodesDraggable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      className="bg-transparent"
    >
      <Viewport fitLabel="Fit the whole network" />
      <Panel position="top-right" className="neu text-muted-foreground hidden gap-1.5 px-3 py-2 text-[10.5px] sm:grid">
        <span className="flex items-center gap-2">
          <svg width="34" height="12" aria-hidden>
            <line x1="2" y1="6" x2="32" y2="6" stroke="var(--tone-accent)" strokeWidth="12" strokeLinecap="round" opacity="0.3" />
            <line x1="2" y1="6" x2="32" y2="6" stroke="var(--tone-accent)" strokeWidth="1.8" />
          </svg>
          sealed · WireGuard, encrypted before it leaves gluetun
        </span>
        <span className="flex items-center gap-2">
          <svg width="34" height="12" aria-hidden>
            <line x1="2" y1="6" x2="32" y2="6" stroke="var(--muted-foreground)" strokeWidth="1.3" opacity="0.6" />
          </svg>
          plain · the home line, as it is
        </span>
      </Panel>
    </ReactFlow>
  );
}
