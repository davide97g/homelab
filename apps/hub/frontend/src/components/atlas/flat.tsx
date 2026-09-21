import { useMemo } from "react";
import type { AtlasFloor, AtlasFocus, AtlasItem } from "@/components/atlas/model";
import { STATUS_TONE, TONE_VAR } from "@/components/primitives";
import { iso, type Vec3 } from "@/components/topology/layout";
import { cn } from "@/lib/utils";

// The same arrangement as the WebGL scene, drawn as a plan.
//
// This is the renderer a phone and a reduced-motion preference actually get,
// so it is a picture in its own right: floors, the orbit each machine owns,
// and a chip you can tap. It reads the same coordinates, through the same
// isometric projection the topology page uses.

function pointsOf(floors: AtlasFloor[], items: AtlasItem[]): Vec3[] {
  const out: Vec3[] = [];
  for (const floor of floors) {
    const [cx, cz] = floor.center;
    const [w, d] = floor.size;
    out.push([cx - w / 2, 0, cz - d / 2], [cx + w / 2, 0.2, cz + d / 2]);
  }
  for (const item of items) out.push(item.at);
  return out;
}

function floorPath(floor: AtlasFloor): string {
  const [cx, cz] = floor.center;
  const [w, d] = floor.size;
  const corners: Vec3[] = [
    [cx - w / 2, 0, cz - d / 2],
    [cx + w / 2, 0, cz - d / 2],
    [cx + w / 2, 0, cz + d / 2],
    [cx - w / 2, 0, cz + d / 2],
  ];
  return corners.map((p, i) => `${i === 0 ? "M" : "L"}${iso(p).join(",")}`).join(" ") + " Z";
}

function orbitPath(item: AtlasItem): string | null {
  if (!item.anchorAt || item.orbit == null) return null;
  const pts: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const p = iso([
      item.anchorAt[0] + Math.cos(a) * item.orbit,
      0.02,
      item.anchorAt[2] + Math.sin(a) * item.orbit,
    ]);
    pts.push(`${i === 0 ? "M" : "L"}${p[0]},${p[1]}`);
  }
  return pts.join(" ");
}

export function AtlasFlat({
  floors,
  items,
  focus,
  onFocus,
  onSelect,
}: {
  floors: AtlasFloor[];
  items: AtlasItem[];
  focus: AtlasFocus;
  onFocus: (focus: AtlasFocus) => void;
  onSelect: (focus: Exclude<AtlasFocus, null>) => void;
}) {
  const frame = useMemo(() => {
    const projected = pointsOf(floors, items).map((p) => iso(p));
    const xs = projected.map((p) => p[0]);
    const ys = projected.map((p) => p[1]);
    const minX = Math.min(...xs) - 28;
    const minY = Math.min(...ys) - 28;
    const maxX = Math.max(...xs) + 28;
    const maxY = Math.max(...ys) + 36;
    return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }, [floors, items]);

  const orbits = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; d: string }[] = [];
    for (const item of items) {
      if (!item.anchor || item.orbit == null) continue;
      const key = `${item.anchor}:${item.orbit.toFixed(2)}`;
      if (seen.has(key)) continue;
      if (items.filter((other) => other.anchor === item.anchor && other.orbit === item.orbit).length < 2) continue;
      const d = orbitPath(item);
      if (!d) continue;
      seen.add(key);
      out.push({ key, d });
    }
    return out;
  }, [items]);

  return (
    <svg
      viewBox={`${frame.minX} ${frame.minY} ${frame.width} ${frame.height}`}
      className="absolute inset-0 h-full w-full"
      role="img"
      aria-label="Devices, services and containers"
    >
      {floors.map((floor) => (
        <g key={floor.id}>
          <path d={floorPath(floor)} fill="var(--muted)" stroke={TONE_VAR[floor.tone]} strokeWidth={1.25} />
          <text
            x={iso([floor.center[0], 0, floor.center[1] + floor.size[1] * 0.28])[0]}
            y={iso([floor.center[0], 0, floor.center[1] + floor.size[1] * 0.28])[1]}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 11, letterSpacing: "0.14em", fontWeight: 600 }}
          >
            {floor.label.toUpperCase()}
          </text>
        </g>
      ))}

      {orbits.map((orbit) => (
        <path key={orbit.key} d={orbit.d} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.35} strokeWidth={1} />
      ))}

      {items.map((item) => {
        if (!item.anchorAt || item.kind === "device") return null;
        const [x1, y1] = iso(item.anchorAt);
        const [x2, y2] = iso(item.at);
        return (
          <line
            key={`stem:${item.kind}:${item.id}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.35}
            strokeWidth={1}
          />
        );
      })}

      {items.map((item) => {
        const [x, y] = iso(item.at);
        const active = focus?.kind === item.kind && focus.id === item.id;
        const r = item.kind === "device" ? 7 : item.kind === "service" ? 5.5 : 4;
        const named = item.kind !== "container" || active;
        return (
          <g
            key={`${item.kind}:${item.id}`}
            role="button"
            tabIndex={0}
            aria-label={`${item.label}, ${item.statusText ?? item.status}`}
            aria-pressed={active}
            onMouseEnter={() => onFocus({ kind: item.kind, id: item.id })}
            onFocus={() => onFocus({ kind: item.kind, id: item.id })}
            onClick={() => onSelect({ kind: item.kind, id: item.id })}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect({ kind: item.kind, id: item.id });
              }
            }}
            className="cursor-pointer outline-none"
          >
            <circle
              cx={x}
              cy={y}
              r={active ? r + 3 : r}
              fill={TONE_VAR[STATUS_TONE[item.status]]}
              fillOpacity={item.kind === "device" ? 0.95 : 0.85}
              stroke={active ? "var(--ring)" : "var(--background)"}
              strokeWidth={active ? 2 : 1.5}
            />
            {named && (
              <text
                x={x}
                y={y - r - 6}
                textAnchor="middle"
                className={cn("fill-foreground", active ? "font-semibold" : "fill-muted-foreground")}
                style={{ fontSize: item.kind === "container" ? 9 : 11, fontWeight: active ? 600 : 500 }}
                stroke="var(--background)"
                strokeWidth={3.5}
                paintOrder="stroke"
              >
                {item.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
