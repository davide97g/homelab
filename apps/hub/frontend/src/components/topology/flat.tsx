import type { Status, Topology } from "@wire";
import { useEffect, useMemo, useRef, useState } from "react";
import { TONE_VAR, STATUS_TONE } from "@/components/primitives";
import { nodeStatusLabel, TRANSPORT_STROKE } from "@/components/topology/panels";
import type { Focus } from "@/components/topology/panels";
import { bezier, iso, linkGeometry, markersOf, NODE_AT, SITE_FLOOR, type Vec3 } from "@/components/topology/layout";
import { cn } from "@/lib/utils";

// The same estate, drawn flat.
//
// This is not a placeholder and it is not a summary. `useRenderer()` sends three
// populations here — anything under 768 px, anything asking for reduced motion,
// and anything whose WebGL probe fails — which between them is most phone
// traffic, so it carries every fact the canvas does: the same sites, the same
// nodes, the same links, and the same hover card, fed from the same payload and
// arranged by the same coordinates in components/topology/layout.ts.
//
// What it drops is the motion, which is the right thing to drop. A reader who
// asked for reduced motion gets the rates as text on the line instead of as a
// flow along it, and a link nothing measures is dashed rather than dimmed.
//
// The hit targets are the SVG groups themselves rather than an HTML overlay: no
// projection is needed here, so there is nothing to synchronise.

const FACE = { top: 1, left: 0.62, right: 0.82 };

/** One node's box in world units. The proportions match what the WebGL scene
 *  draws so the two read as the same objects. */
const BOX: Record<string, [number, number, number]> = {
  homelab: [1, 0.36, 1],
  plug: [0.34, 0.34, 0.24],
  fritzbox: [0.88, 0.14, 0.58],
  nas: [0.95, 0.72, 0.88],
  "nas-router": [0.88, 0.14, 0.58],
};

function pts(points: [number, number][]): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

/** A cuboid as three faces. Enough of a solid to read as hardware without being
 *  a second 3D renderer. */
function isoBox(at: Vec3, size: [number, number, number]) {
  const [w, h, d] = size;
  const [x, y, z] = at;
  const hw = w / 2;
  const hd = d / 2;
  const top = y + h / 2;
  const bottom = y - h / 2;

  const p = (px: number, py: number, pz: number) => iso([px, py, pz]);

  return {
    top: pts([p(x - hw, top, z - hd), p(x + hw, top, z - hd), p(x + hw, top, z + hd), p(x - hw, top, z + hd)]),
    left: pts([p(x - hw, top, z + hd), p(x - hw, bottom, z + hd), p(x - hw, bottom, z - hd), p(x - hw, top, z - hd)]),
    right: pts([p(x - hw, top, z + hd), p(x + hw, top, z + hd), p(x + hw, bottom, z + hd), p(x - hw, bottom, z + hd)]),
  };
}

function statusVar(status: Status): string {
  return TONE_VAR[STATUS_TONE[status]];
}

/** How many SVG units fit in one CSS pixel right now.
 *
 *  The drawing is laid out in world units and scaled to fit, so a chip written
 *  at a fixed unit size renders at whatever the browser's scale factor makes it
 *  — around four pixels on a phone, which is not a label, it is a smudge. The
 *  labels are the half of this picture that carries the facts, so they are sized
 *  in pixels and converted back into units here. */
function useUnitsPerPixel(ref: React.RefObject<SVGSVGElement | null>, viewBoxWidth: number): number {
  const [ratio, setRatio] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = el.getBoundingClientRect().width;
      setRatio(width > 0 ? viewBoxWidth / width : 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, viewBoxWidth]);

  return ratio;
}

export function TopologyFlat({
  topology,
  focus,
  selected,
  onFocus,
  onSelect,
  className,
}: {
  topology: Topology;
  focus: Focus;
  selected: Focus;
  onFocus: (focus: Focus) => void;
  onSelect: (focus: Exclude<Focus, null>) => void;
  className?: string;
}) {
  const geometry = useMemo(() => linkGeometry(topology), [topology]);
  const markers = useMemo(() => markersOf(topology), [topology]);

  const floors = useMemo(
    () =>
      topology.sites
        .filter((s) => s.id !== "cloud")
        .map((site) => {
          const floor = SITE_FLOOR[site.id as "davide" | "ilario"];
          const [cx, cz] = floor.center;
          const [w, d] = floor.size;
          // The same house the WebGL scene builds, as a line drawing: four
          // corners, the eaves, the ridge and the rakes. Stroke only — a filled
          // wall here would sit on top of the hardware inside it, and this
          // renderer has no transparency budget to spend getting it back.
          const hw = w / 2;
          const hd = d / 2;
          const wall = floor.wall;
          const apex = floor.wall + floor.roof;
          const at = (x: number, y: number, z: number) => iso([cx + x, y, cz + z]);
          const corners: [number, number][] = [
            [-hw, -hd],
            [hw, -hd],
            [hw, hd],
            [-hw, hd],
          ];
          const line = (a: [number, number], b: [number, number]) =>
            `M ${a[0].toFixed(1)} ${a[1].toFixed(1)} L ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;

          const ridgeL = at(-hw, apex, 0);
          const ridgeR = at(hw, apex, 0);
          const eaves = corners.map(([x, z]) => at(x, wall, z));
          const house = [
            ...corners.map(([x, z], i) => line(at(x, 0, z), eaves[i]!)),
            ...eaves.map((a, i) => line(a, eaves[(i + 1) % eaves.length]!)),
            line(ridgeL, ridgeR),
            line(eaves[0]!, ridgeL),
            line(eaves[3]!, ridgeL),
            line(eaves[1]!, ridgeR),
            line(eaves[2]!, ridgeR),
          ].join(" ");

          return {
            id: site.id,
            label: site.label,
            points: pts([
              iso([cx - w / 2, 0, cz - d / 2]),
              iso([cx + w / 2, 0, cz - d / 2]),
              iso([cx + w / 2, 0, cz + d / 2]),
              iso([cx - w / 2, 0, cz + d / 2]),
            ]),
            house,
            // Every point the house touches, so the frame below can be measured
            // from the roofline rather than from the slab it used to stop at.
            bounds: [...corners.map(([x, z]) => at(x, 0, z)), ...eaves, ridgeL, ridgeR],
            labelAt: iso([cx, 0, cz + d / 2]),
          };
        }),
    [topology.sites],
  );

  // The frame is measured from the drawing rather than guessed, so adding a node
  // on the far side of a flat cannot push it off the edge.
  const box = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    const eat = ([x, y]: [number, number]) => {
      xs.push(x);
      ys.push(y);
    };
    for (const node of topology.nodes) {
      const at = NODE_AT[node.id];
      if (at) eat(iso(at));
    }
    for (const g of geometry.values()) {
      for (let t = 0; t <= 1.001; t += 0.25) eat(iso(bezier(g.from, g.control, g.to, t)));
    }
    for (const floor of floors) {
      for (const point of floor.bounds) eat(point);
    }
    const pad = 46;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return {
      minX,
      minY,
      width: Math.max(...xs) + pad - minX,
      height: Math.max(...ys) + pad - minY,
    };
  }, [topology.nodes, geometry, floors]);

  const svg = useRef<SVGSVGElement>(null);
  const k = useUnitsPerPixel(svg, box.width);

  // On a phone there is simply not room for eight chips over a drawing this
  // wide, and overlapping them helps nobody. Below this width the node names
  // drop to their status dots and the ledger directly underneath carries every
  // one of them by name — which on a small screen is the better reading order
  // anyway. The two cross-flat rates stay, because they are the point.
  const dense = box.width / k < 560;

  return (
    <svg
      ref={svg}
      viewBox={`${box.minX} ${box.minY} ${box.width} ${box.height}`}
      className={cn("h-full w-full", className)}
      role="img"
      aria-label="The two flats, their devices and the paths between them. The list beside this chart carries the same information as text."
    >
      {floors.map((floor) => (
        <g key={floor.id}>
          <polygon points={floor.points} fill="var(--muted)" stroke="var(--border)" strokeWidth={1.5 * k} />
          <path
            d={floor.house}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth={1.2 * k}
            strokeLinecap="round"
            opacity={0.35}
          />
          <text
            x={floor.labelAt[0]}
            y={floor.labelAt[1] + 16 * k}
            textAnchor="middle"
            fontSize={10 * k}
            className="fill-muted-foreground font-medium tracking-[0.18em] uppercase"
          >
            {floor.label}
          </text>
        </g>
      ))}

      {topology.links.map((link) => {
        const g = geometry.get(link.id);
        if (!g) return null;
        const a = iso(g.from);
        const c = iso(g.control);
        const b = iso(g.to);
        const measured = link.status !== "unconfigured";
        const active = focus?.kind === "link" && focus.id === link.id;

        // Three quarters along, clear of the rate chip that floats at the
        // midpoint. Two samples either side of it give the tangent; the curve is
        // a quadratic, so there is nothing subtler worth doing.
        const head = iso(bezier(g.from, g.control, g.to, 0.75));
        const before = iso(bezier(g.from, g.control, g.to, 0.71));
        const after = iso(bezier(g.from, g.control, g.to, 0.79));
        const angle = (Math.atan2(after[1] - before[1], after[0] - before[0]) * 180) / Math.PI;
        const arrow = (measured ? 6.5 : 5) * k;

        return (
          <g key={link.id}>
            <path
              d={`M ${a[0]} ${a[1]} Q ${c[0]} ${c[1]} ${b[0]} ${b[1]}`}
              fill="none"
              // Written out rather than derived from the swatch class: Tailwind
              // scans source text, so a class assembled at runtime is never
              // generated and the line would come out black.
              className={cn("stroke-current", TRANSPORT_STROKE[link.transport])}
              strokeWidth={(active ? 3.5 : measured ? 2.5 : 1.5) * k}
              strokeDasharray={measured ? undefined : `${5 * k} ${6 * k}`}
              opacity={link.status === "down" ? 0.35 : measured ? 0.75 : 0.5}
              strokeLinecap="round"
            />
            {/* Not motion — direction. Who dials whom is a fact about the
              configuration, so it is drawn on the unmeasured paths too. */}
            <polygon
              points={pts([
                [0, -arrow * 0.62],
                [arrow * 1.35, 0],
                [0, arrow * 0.62],
              ])}
              transform={`translate(${head[0].toFixed(1)} ${head[1].toFixed(1)}) rotate(${angle.toFixed(1)})`}
              className={cn("fill-current", TRANSPORT_STROKE[link.transport])}
              opacity={link.status === "down" ? 0.45 : measured ? 0.85 : 0.6}
            />
          </g>
        );
      })}

      {topology.nodes.map((node) => {
        const at = NODE_AT[node.id];
        if (!at) return null;
        const size = BOX[node.id];
        const active = focus?.kind === "node" && focus.id === node.id;

        if (!size) {
          // The edge has no chassis, so it is a ring rather than a box.
          const [x, y] = iso(at);
          return (
            <g key={node.id}>
              <circle
                cx={x}
                cy={y}
                r={13}
                fill="none"
                stroke={statusVar(node.status)}
                strokeWidth={2.5 * k}
                opacity={0.9}
              />
              <circle cx={x} cy={y} r={5} fill={statusVar(node.status)} opacity={active ? 1 : 0.7} />
            </g>
          );
        }

        const faces = isoBox(at, size);
        return (
          <g key={node.id} opacity={node.status === "unconfigured" ? 0.65 : 1}>
            <polygon points={faces.left} fill="var(--muted-foreground)" fillOpacity={FACE.left * 0.55} />
            <polygon points={faces.right} fill="var(--muted-foreground)" fillOpacity={FACE.right * 0.55} />
            <polygon
              points={faces.top}
              fill="var(--muted-foreground)"
              fillOpacity={FACE.top * 0.45}
              stroke={active ? statusVar(node.status) : "var(--border)"}
              strokeWidth={(active ? 2 : 1) * k}
            />
          </g>
        );
      })}

      {/* Labels last, so nothing is drawn over them, and focusable so the whole
          picture can be walked with the keyboard. */}
      {markers.map((marker) => {
        const [x, y] = iso(marker.at);
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

        // Same rule as the canvas: a link inside one flat is context and shrinks
        // to a dot until it is pointed at, so the two that cross between the
        // flats are the ones stating a number.
        const collapsed =
          (!active &&
            ((marker.kind === "node" && marker.id !== "edge" && marker.id !== "cinema-edge" && marker.id !== "viewer") ||
              (marker.kind === "link" && !marker.prominent))) ||
          (dense && !active && (marker.kind === "node" || !marker.prominent));
        const width = (collapsed ? 16 : text.length * 5.6 + (node ? 18 : 12)) * k;
        const height = 18 * k;

        return (
          <g
            key={`${marker.kind}:${marker.id}`}
            tabIndex={0}
            role="button"
            aria-label={node ? `${node.label}, ${nodeStatusLabel(node.status)}` : `${link?.carries}: ${text}`}
            aria-pressed={active}
            onMouseEnter={() => onFocus({ kind: marker.kind, id: marker.id })}
            onFocus={() => onFocus({ kind: marker.kind, id: marker.id })}
            onClick={() => onSelect({ kind: marker.kind, id: marker.id })}
            className="focus-visible:outline-ring cursor-pointer focus-visible:outline-2"
          >
            <rect
              x={x - width / 2}
              y={y - height / 2}
              width={width}
              height={height}
              rx={height / 2}
              fill="var(--card)"
              stroke={active ? "var(--ring)" : "var(--border)"}
              strokeWidth={(active ? 1.6 : 1) * k}
              opacity={0.94}
            />
            {node && !collapsed && <circle cx={x - width / 2 + 9 * k} cy={y} r={3 * k} fill={statusVar(node.status)} />}
            {selected?.kind === marker.kind && selected.id === marker.id && (
              <>
                <circle cx={x} cy={y} r={height * 0.82} fill="none" stroke="var(--ring)" strokeWidth={1.1 * k} opacity={0.72} />
                <path d={`M ${x} ${y - height * 0.82} L ${x} ${y - height * 1.55}`} stroke="var(--ring)" strokeWidth={1.1 * k} opacity={0.62} />
              </>
            )}
            {collapsed ? (
              <circle
                cx={x}
                cy={y}
                r={(node ? 3.5 : 2.5) * k}
                fill={node ? statusVar(node.status) : undefined}
                className={node ? undefined : "fill-muted-foreground"}
              />
            ) : (
              <text
                x={node ? x + 5 * k : x}
                y={y + 3.5 * k}
                textAnchor="middle"
                fontSize={9.5 * k}
                className={cn(link ? "fill-muted-foreground" : "fill-foreground font-medium")}
              >
                {text}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
