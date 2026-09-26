import type { HostSummary, MediaPipeline, VpnSnapshot } from "@wire";
import {
  MarkerType,
  Panel,
  ReactFlow,
  useReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from "@xyflow/react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useMemo } from "react";
import { HostNode } from "@/components/media/host-node";
import { ServiceNode } from "@/components/media/service-node";
import { TunnelFrame } from "@/components/media/tunnel-frame";
import { VpnNode } from "@/components/media/vpn-node";
import { Button } from "@/components/ui/button";

// React Flow's own stylesheet. It is imported here rather than in index.css on
// purpose: this module is loaded lazily, so a page that never opens /media never
// pays for either the library or its CSS.
import "@xyflow/react/dist/style.css";

const NODE_TYPES = { service: ServiceNode, host: HostNode, vpn: VpnNode, tunnel: TunnelFrame };

// Tokens, never literals. mediarr-dash writes its three edge colours as raw
// oklch strings, which is fine in an app that is permanently dark and would mean
// two hand-picked values per colour here. An SVG stroke resolves a CSS variable
// against the element, so these follow the theme for free.
const FORWARD = "var(--primary)";
const FEEDBACK = "var(--tone-accent)";
const TUNNEL = "var(--tone-accent)";
const CUT = "var(--tone-bad)";
const DIM = "var(--muted-foreground)";

/** Where the box sits. The only piece of layout not described by the server,
 *  because the host node is not in /api/media at all — the page fills it from
 *  the summary it already holds. Left of the front door, clear of the row. */
const HOST_POSITION = { x: -340, y: 60 };

/** The WireGuard boundary, drawn behind the two nodes it contains. Sized from
 *  the server's positions for qBittorrent and the VPN plus their card sizes, so
 *  moving either on the server moves the frame with it. */
const FRAME_PAD = { x: 26, top: 38, bottom: 30 };
const CARD = { qbittorrent: { w: 260, h: 330 }, vpn: { w: 300, h: 390 } };

function tunnelFrame(data: MediaPipeline, vpn: VpnSnapshot | null): FlowNode | null {
  const qbit = data.nodes.find((n) => n.id === "qbittorrent");
  const box = data.nodes.find((n) => n.id === "vpn");
  if (!qbit || !box) return null;
  const left = Math.min(qbit.position.x, box.position.x) - FRAME_PAD.x;
  const right = Math.max(qbit.position.x + CARD.qbittorrent.w, box.position.x + CARD.vpn.w) + FRAME_PAD.x;
  const top = box.position.y - FRAME_PAD.top;
  const bottom = qbit.position.y + CARD.qbittorrent.h + FRAME_PAD.bottom;
  return {
    id: "tunnel-frame",
    type: "tunnel",
    position: { x: left, y: top },
    data: { vpn, width: right - left, height: bottom - top },
    draggable: false,
    selectable: false,
    focusable: false,
    zIndex: -1,
  };
}

/** Zoom and fit, in the hub's own buttons rather than React Flow's `<Controls>`.
 *  That component ships its own light-mode styling and reads as a white brick in
 *  dark, and theming it means overriding its CSS from outside this lazy chunk —
 *  three buttons against the token set is less code and cannot drift. */
function Viewport() {
  const flow = useReactFlow();
  return (
    <Panel position="bottom-left" className="flex flex-col gap-1">
      <Button variant="outline" size="icon-sm" aria-label="Zoom in" onClick={() => flow.zoomIn()}>
        <Plus />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label="Zoom out" onClick={() => flow.zoomOut()}>
        <Minus />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Fit the whole pipeline"
        onClick={() => flow.fitView({ padding: 0.12, maxZoom: 1 })}
      >
        <Maximize2 />
      </Button>
    </Panel>
  );
}

export default function PipelineGraph({
  data,
  host,
  selected,
  onSelect,
  onChanged,
}: {
  data: MediaPipeline;
  host: HostSummary;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Called after the kill switch acts, so the page re-polls at once. */
  onChanged: () => void;
}) {
  const frame = useMemo(() => tunnelFrame(data, data.vpn), [data]);
  const nodes = useMemo<FlowNode[]>(
    () => [
      ...(frame ? [frame] : []),
      {
        id: "host",
        type: "host",
        position: HOST_POSITION,
        data: { host },
        draggable: true,
      },
      ...data.nodes.map(
        (node): FlowNode =>
          node.kind === "vpn"
            ? {
                id: node.id,
                type: "vpn",
                position: node.position,
                data: { node, vpn: data.vpn, selected: selected === node.id, onSelect, onChanged },
                // Pinned, like the frame around it: dragging the tunnel out of
                // its own boundary would draw a picture that is not true.
                draggable: false,
                // React Flow gives a node that is neither draggable nor
                // selectable `pointer-events: none`, so without this the kill
                // switch would sit under the pane and never receive a click.
                style: { pointerEvents: "all" },
              }
            : {
                id: node.id,
                type: "service",
                position: node.position,
                data: { node, selected: selected === node.id, onSelect: (id: string) => onSelect(id) },
                // qBittorrent is inside the frame for the same reason, and needs
                // the same pointer-events override to stay clickable.
                draggable: node.id !== "qbittorrent",
                ...(node.id === "qbittorrent" ? { style: { pointerEvents: "all" as const } } : {}),
              },
      ),
    ],
    [data.nodes, data.vpn, frame, host, selected, onSelect, onChanged],
  );

  const edges = useMemo<FlowEdge[]>(() => {
    const cut = data.vpn?.killSwitch ?? false;
    const pipeline = data.edges.map((edge): FlowEdge => {
      const feedback = edge.kind === "feedback";
      const tunnel = edge.kind === "tunnel";
      const colour = tunnel ? (cut ? CUT : TUNNEL) : feedback ? FEEDBACK : FORWARD;
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        type: feedback ? "smoothstep" : "default",
        // The availability edge leaves and arrives underneath, so it loops below
        // the row instead of crossing back over every card in it.
        ...(feedback
          ? { sourceHandle: "under", targetHandle: "under", pathOptions: { borderRadius: 24, offset: 44 } }
          : {}),
        // Straight up out of qBittorrent into the card above it, and red and
        // dashed while the kill switch holds it: the path exists, nothing may
        // use it.
        ...(tunnel ? { sourceHandle: "over", targetHandle: "into", label: cut ? "cut · kill switch" : edge.label } : {}),
        // The rule the topology page keeps too: nothing moves unless something
        // is actually moving. `active` is the server's word, decided from the
        // collectors' numbers — a quiet pipeline looks quiet.
        animated: edge.active,
        style: {
          stroke: edge.active || (tunnel && cut) ? colour : DIM,
          strokeWidth: edge.active ? 2 : tunnel ? 1.6 : 1.2,
          strokeDasharray: feedback || (tunnel && cut) ? "5 5" : undefined,
          opacity: edge.active || (tunnel && cut) ? 1 : 0.45,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edge.active || (tunnel && cut) ? colour : DIM,
          width: 14,
          height: 14,
        },
        labelShowBg: true,
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 6,
        labelBgStyle: { fill: "var(--card)", fillOpacity: 0.95 },
        labelStyle: { fill: "var(--muted-foreground)", fontSize: 10, fontWeight: 500 },
        ariaLabel: `${edge.label}: ${edge.note}`,
      };
    });

    // The box does not take part in the pipeline; it carries it. One faint
    // dashed link per lane says so without implying a request ever flows
    // through it: the film lane starts at Jellyseerr, the manga one at Suwayomi.
    const present = new Set(data.nodes.map((n) => n.id));
    const carries: FlowEdge[] = ["jellyseerr", "suwayomi"]
      .filter((id) => present.has(id))
      .map((target) => ({
        id: `host-carries-${target}`,
        source: "host",
        target,
        type: "default",
        animated: false,
        style: { stroke: DIM, strokeWidth: 1, strokeDasharray: "2 6", opacity: 0.4 },
      }));

    return [...carries, ...pipeline];
  }, [data.edges, data.nodes, data.vpn]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      onPaneClick={() => onSelect(null)}
      className="bg-transparent"
    >
      <Viewport />
    </ReactFlow>
  );
}
