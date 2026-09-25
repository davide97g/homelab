import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from "@xyflow/react";
import { useMemo } from "react";

import { HostNode } from "@/components/host-node";
import { ServiceNode } from "@/components/service-node";
import type { Overview, Snapshot } from "@/lib/api";

const NODE_TYPES = { service: ServiceNode, host: HostNode };

const PRIMARY = "oklch(0.6854 0.1699 252.9926)";
const ACCENT = "oklch(0.7748 0.1318 201.6395)";
const DIM = "oklch(0.45 0.02 258)";

/** Which links currently carry something.
 *
 *  An edge is only worth animating when work is actually moving along it, so
 *  each one is tied to a number from the node it leaves: requests in progress,
 *  a non-empty queue, bytes on the wire. A quiet pipeline should look quiet. */
function busyEdges(services: Snapshot[]): Set<string> {
  const by = new Map(services.map((s) => [s.id, s]));
  const num = (id: string, label: string): number => {
    const stat = by.get(id)?.stats.find((s) => s.label === label);
    if (!stat) return 0;
    const n = Number.parseFloat(stat.value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const downloading = (by.get("qbittorrent")?.stats.find((s) => s.label === "Download")?.value ?? "idle") !== "idle";

  const busy = new Set<string>();
  const processing = num("jellyseerr", "Processing") + num("jellyseerr", "Pending");
  if (processing > 0) {
    busy.add("seer-radarr");
    busy.add("seer-sonarr");
  }
  if (num("radarr", "Queue") > 0) busy.add("radarr-prowlarr");
  if (num("sonarr", "Queue") > 0) busy.add("sonarr-prowlarr");
  if (downloading) {
    busy.add("prowlarr-qbit");
    busy.add("qbit-bazarr");
  }
  if (num("bazarr", "Wanted") > 0) busy.add("bazarr-jellyfin");
  if (num("jellyfin", "Now playing") > 0) busy.add("jellyfin-seer");
  return busy;
}

export function PipelineGraph({
  data,
  selected,
  onSelect,
}: {
  data: Overview;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const nodes = useMemo<FlowNode[]>(() => {
    const serviceNodes: FlowNode[] = data.services.map((snapshot) => ({
      id: snapshot.id,
      type: "service",
      position: data.positions[snapshot.id] ?? { x: 0, y: 0 },
      data: {
        snapshot,
        load: data.host.containers?.[snapshot.id],
        selected: selected === snapshot.id,
        onSelect,
      },
      draggable: true,
    }));

    return [
      {
        id: "host",
        type: "host",
        position: data.positions.host ?? { x: 0, y: 150 },
        data: { host: data.host },
        draggable: true,
      },
      ...serviceNodes,
    ];
  }, [data, selected, onSelect]);

  const edges = useMemo<FlowEdge[]>(() => {
    const busy = busyEdges(data.services);
    const statusById = new Map(data.services.map((s) => [s.id, s.status]));

    const pipeline = data.edges.map((e) => {
      const broken = statusById.get(e.source) === "down" || statusById.get(e.target) === "down";
      const feedback = e.kind === "feedback";
      const active = busy.has(e.id) && !broken;
      const color = broken ? DIM : feedback ? ACCENT : PRIMARY;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        type: feedback ? "smoothstep" : "default",
        ...(feedback ? { sourceHandle: "under", targetHandle: "under", pathOptions: { borderRadius: 24, offset: 40 } } : {}),
        animated: active,
        style: {
          stroke: color,
          strokeWidth: active ? 2 : 1.4,
          strokeDasharray: feedback ? "5 5" : undefined,
          opacity: broken ? 0.35 : active ? 1 : 0.6,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        labelShowBg: true,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        labelBgStyle: { fill: "oklch(0.2417 0.0194 258.3564)", fillOpacity: 0.95 },
        labelStyle: { fill: "oklch(0.7005 0.0204 248.1197)", fontSize: 10, fontWeight: 500 },
      } satisfies FlowEdge;
    });

    // The host does not take part in the pipeline; it carries it. One faint link
    // says so without implying a request ever flows through it.
    const carries: FlowEdge = {
      id: "host-seer",
      source: "host",
      target: "jellyseerr",
      type: "default",
      animated: false,
      style: { stroke: DIM, strokeWidth: 1, strokeDasharray: "2 6", opacity: 0.5 },
    };

    return [carries, ...pipeline];
  }, [data.services, data.edges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.14, maxZoom: 1 }}
      minZoom={0.25}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      elementsSelectable={false}
      onPaneClick={() => onSelect("")}
      className="bg-transparent"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="oklch(0.36 0.02 258)" />
      <Controls showInteractive={false} className="!bottom-4 !left-4 !shadow-lg" />
    </ReactFlow>
  );
}
