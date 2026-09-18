import type { Topology } from "@wire";
import { lazy, Suspense, useMemo, useRef } from "react";
import { StatusDot } from "@/components/primitives";
import { useRenderer } from "@/components/three/webgl";
import { TopologyFlat } from "@/components/topology/flat";
import { markersOf } from "@/components/topology/layout";
import { nodeStatusLabel, TRANSPORT_SWATCH, type Focus } from "@/components/topology/panels";
import { cn } from "@/lib/utils";

/** One estate, two renderers, one payload.
 *
 *  The same bargain `machine-hero.tsx` makes, for the same reasons. The flat SVG
 *  is a real renderer rather than a downgrade, so it is safe to keep three out of
 *  the initial bundle: the lazy chunk carries no data of its own, and failing to
 *  load it costs the depth and nothing else. It is the Suspense fallback too, so
 *  during the fetch the page is complete rather than loading. */
const TopologyScene = lazy(() => import("@/components/topology/scene"));

export function TopologyMap({
  topology,
  focus,
  onFocus,
  className,
}: {
  topology: Topology;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  className?: string;
}) {
  const renderer = useRenderer();
  const elements = useRef(new Map<string, HTMLElement>());

  // Markers move only when the graph does, not when its numbers do.
  const shape = topology.nodes.map((n) => n.id).join(",") + "|" + topology.links.map((l) => l.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const markers = useMemo(() => markersOf(topology), [shape]);

  const flat = <TopologyFlat topology={topology} focus={focus} onFocus={onFocus} />;

  // Behind both renderers, not just the canvas: the flat SVG is a real renderer
  // and gets the same ground. It is `aria-hidden` and behind everything, so it
  // is texture and nothing else.
  // No negative z-index: this container is not a stacking context, so a negative
  // layer would sink behind whatever ancestor happens to have a background. It
  // is simply first in the DOM, and everything after it paints on top.
  const ground = <div aria-hidden className="dotfield pointer-events-none absolute inset-0" />;

  if (renderer === "flat") {
    return (
      <div className={cn("relative", className)}>
        {ground}
        {flat}
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      {ground}
      <Suspense fallback={flat}>
        <TopologyScene topology={topology} markers={markers} elements={elements} />
      </Suspense>

      {/* The labels, which are also the hit targets.
          DOM rather than sprites: sharper, themed from the same tokens,
          selectable, and — the part that matters — focusable, so the picture can
          be tabbed through instead of needing a pointer. The scene raycasts
          nothing. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {markers.map((marker) => {
          const key = `${marker.kind}:${marker.id}`;
          const node = marker.kind === "node" ? topology.nodes.find((n) => n.id === marker.id) : undefined;
          const link = marker.kind === "link" ? topology.links.find((l) => l.id === marker.id) : undefined;
          const active = focus?.kind === marker.kind && focus.id === marker.id;

          const text = node
            ? node.label
            : link?.rate
              ? link.rate.display
              : link?.cadenceS !== undefined
                ? `every ${link.cadenceS}s`
                : "not measured";

          // A link inside one flat is context; one that crosses between them is
          // the point. Context shrinks to a dot until you point at it.
          const collapsed = marker.kind === "link" && !marker.prominent && !active;

          return (
            <button
              key={key}
              type="button"
              ref={(el) => {
                if (el) elements.current.set(key, el);
                else elements.current.delete(key);
              }}
              // Placed and revealed by the scene's projector on its first frame.
              // Before that a marker has nowhere to be, and the whole set would
              // flash in the top-left corner on the way in.
              style={{ opacity: 0 }}
              aria-label={node ? `${node.label}, ${nodeStatusLabel(node.status)}` : `${link?.carries}: ${text}`}
              onMouseEnter={() => onFocus({ kind: marker.kind, id: marker.id })}
              onFocus={() => onFocus({ kind: marker.kind, id: marker.id })}
              onClick={() => onFocus({ kind: marker.kind, id: marker.id })}
              className={cn(
                "pointer-events-auto absolute top-0 left-0 flex items-center rounded-full border",
                "transition-[opacity,background-color,border-color,padding] duration-200 motion-reduce:transition-none",
                "focus-visible:ring-ring/60 focus-visible:ring-2 focus-visible:outline-none",
                collapsed ? "p-2" : "gap-1.5 px-2 py-1",
                node
                  ? node.status === "unconfigured"
                    ? "text-[10px]"
                    : "text-[11px] font-medium"
                  : "tnum font-mono text-[10px]",
                active
                  ? "bg-card border-ring/70 text-foreground"
                  : "bg-card/80 border-border text-muted-foreground hover:bg-card",
              )}
            >
              {node ? (
                <StatusDot status={node.status} />
              ) : link ? (
                <span className={cn("size-1.5 shrink-0 rounded-full", TRANSPORT_SWATCH[link.transport])} aria-hidden />
              ) : null}
              {!collapsed && text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
