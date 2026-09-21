import { lazy, Suspense, useRef } from "react";
import { AtlasFlat } from "@/components/atlas/flat";
import type { AtlasFloor, AtlasFocus, AtlasItem, Vec3 } from "@/components/atlas/model";
import { STATUS_TONE, TONE_BG } from "@/components/primitives";
import { nodeStatusLabel } from "@/components/topology/panels";
import { useRenderer } from "@/components/three/webgl";
import { cn } from "@/lib/utils";

const AtlasScene = lazy(() => import("@/components/atlas/scene"));

export function AtlasStage({
  items,
  floors,
  bounds,
  focus,
  namedContainers,
  onFocus,
  onSelect,
  className,
}: {
  items: AtlasItem[];
  floors: AtlasFloor[];
  bounds: { min: Vec3; max: Vec3 };
  focus: AtlasFocus;
  /** Container names stay dots until asked for, unless this layer is containers. */
  namedContainers: boolean;
  onFocus: (focus: AtlasFocus) => void;
  onSelect: (focus: Exclude<AtlasFocus, null>) => void;
  className?: string;
}) {
  const renderer = useRenderer();
  const elements = useRef(new Map<string, HTMLElement>());
  const focusItem = focus ? items.find((item) => item.kind === focus.kind && item.id === focus.id) : undefined;

  const flat = (
    <AtlasFlat floors={floors} items={items} focus={focus} onFocus={onFocus} onSelect={onSelect} />
  );

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div aria-hidden className="dotfield pointer-events-none absolute inset-0" />
      {renderer === "flat" ? (
        flat
      ) : (
        <Suspense fallback={flat}>
          <AtlasScene
            items={items}
            floors={floors}
            bounds={bounds}
            focusId={focus?.id ?? null}
            focusAnchor={focusItem?.anchor ?? (focus?.kind === "device" ? focus.id : null)}
            elements={elements}
          />
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {items.map((item) => {
              const key = `${item.kind}:${item.id}`;
              const active = focus?.kind === item.kind && focus.id === item.id;
              const named = item.kind !== "container" || namedContainers || active;
              return (
                <button
                  key={key}
                  type="button"
                  ref={(el) => {
                    if (el) elements.current.set(key, el);
                    else elements.current.delete(key);
                  }}
                  style={{ opacity: 0 }}
                  aria-label={`${item.label}, ${item.statusText ?? nodeStatusLabel(item.status)}`}
                  aria-pressed={active}
                  onMouseEnter={() => onFocus({ kind: item.kind, id: item.id })}
                  onFocus={() => onFocus({ kind: item.kind, id: item.id })}
                  onClick={() => onSelect({ kind: item.kind, id: item.id })}
                  className={cn(
                    "pointer-events-auto absolute top-0 left-0 flex items-center rounded-full border",
                    "transition-[opacity,background-color,border-color,padding] duration-200 motion-reduce:transition-none",
                    "focus-visible:ring-ring/60 focus-visible:ring-2 focus-visible:outline-none",
                    named ? "gap-1.5 px-2 py-1" : "p-2",
                    active
                      ? "bg-card border-ring/70 text-foreground"
                      : "bg-card/80 border-border text-muted-foreground hover:bg-card",
                    item.kind === "container" ? "text-[10px]" : "text-[11px] font-medium",
                  )}
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", TONE_BG[STATUS_TONE[item.status]])} aria-hidden />
                  {named && item.label}
                </button>
              );
            })}
          </div>
        </Suspense>
      )}
    </div>
  );
}
