import type { HostSummary, MediaPipeline } from "@wire";
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
import { Button } from "@/components/ui/button";

// React Flow's own stylesheet. It is imported here rather than in index.css on
// purpose: this module is loaded lazily, so a page that never opens /media never
// pays for either the library or its CSS.
import "@xyflow/react/dist/style.css";

const NODE_TYPES = { service: ServiceNode, host: HostNode };

// Tokens, never literals. mediarr-dash writes its three edge colours as raw
// oklch strings, which is fine in an app that is permanently dark and would mean
// two hand-picked values per colour here. An SVG stroke resolves a CSS variable
// against the element, so these follow the theme for free.
const FORWARD = "var(--primary)";
const FEEDBACK = "var(--tone-accent)";
const DIM = "var(--muted-foreground)";

/** Where the box sits. The only piece of layout not described by the server,
 *  because the host node is not in /api/media at all — the page fills it from
 *  the summary it already holds. Left of the front door, clear of the row. */
const HOST_POSITION = { x: -340, y: 60 };

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
}: {
  data: MediaPipeline;
  host: HostSummary;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const nodes = useMemo<FlowNode[]>(
    () => [
      {
        id: "host",
        type: "host",
        position: HOST_POSITION,
        data: { host },
        draggable: true,
      },
      ...data.nodes.map(
        (node): FlowNode => ({
          id: node.id,
          type: "service",
          position: node.position,
          data: { node, selected: selected === node.id, onSelect: (id: string) => onSelect(id) },
          draggable: true,
        }),
      ),
    ],
    [data.nodes, host, selected, onSelect],
  );

  const edges = useMemo<FlowEdge[]>(() => {
    const pipeline = data.edges.map((edge): FlowEdge => {
      const feedback = edge.kind === "feedback";
      const colour = feedback ? FEEDBACK : FORWARD;
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
        // The rule the topology page keeps too: nothing moves unless something
        // is actually moving. `active` is the server's word, decided from the
        // collectors' numbers — a quiet pipeline looks quiet.
        animated: edge.active,
        style: {
          stroke: edge.active ? colour : DIM,
          strokeWidth: edge.active ? 2 : 1.2,
          strokeDasharray: feedback ? "5 5" : undefined,
          opacity: edge.active ? 1 : 0.45,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: edge.active ? colour : DIM, width: 14, height: 14 },
        labelShowBg: true,
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 6,
        labelBgStyle: { fill: "var(--card)", fillOpacity: 0.95 },
        labelStyle: { fill: "var(--muted-foreground)", fontSize: 10, fontWeight: 500 },
        ariaLabel: `${edge.label}: ${edge.note}`,
      };
    });

    // The box does not take part in the pipeline; it carries it. One faint
    // dashed link says so without implying a request ever flows through it.
    const carries: FlowEdge = {
      id: "host-carries",
      source: "host",
      target: "jellyseerr",
      type: "default",
      animated: false,
      style: { stroke: DIM, strokeWidth: 1, strokeDasharray: "2 6", opacity: 0.4 },
    };

    return [carries, ...pipeline];
  }, [data.edges]);

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
