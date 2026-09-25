import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronRight, Server, Zap } from "lucide-react";
import { memo } from "react";

import { FieldLabel, Ring } from "@/components/primitives";
import type { Host } from "@/lib/api";
import { cn } from "@/lib/utils";

export type HostNodeData = { host: Host };
export type HostFlowNode = Node<HostNodeData, "host">;

/** A ring goes from the theme's blue through cyan to red as it fills, so a hot
 *  number is obvious before the label is read. */
function ringColor(pct: number): string {
  if (pct >= 90) return "oklch(0.5494 0.1993 25.1156)";
  if (pct >= 75) return "oklch(0.80 0.145 82)";
  if (pct >= 50) return "oklch(0.7748 0.1318 201.6395)";
  return "oklch(0.6854 0.1699 252.9926)";
}

function HostNodeImpl({ data }: NodeProps<HostFlowNode>) {
  const h = data.host;

  return (
    <div className="panel w-[312px] rounded-xl border border-border/70">
      <Handle type="source" position={Position.Right} />

      <header className="flex items-start gap-2 px-3.5 pt-3 pb-2.5">
        <ChevronRight className="text-muted-foreground mt-[3px] size-3 shrink-0" />
        <Server className="text-accent mt-px size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="text-[13px] leading-tight font-semibold tracking-tight">Homelab</span>
          <p className="text-muted-foreground truncate font-mono text-[10px] leading-tight">{h.name}</p>
        </div>
        <a
          href={h.link}
          target="_blank"
          rel="noreferrer noopener"
          title="Open Grafana"
          className="text-muted-foreground hover:bg-muted hover:text-foreground -mt-0.5 -mr-1 rounded-md p-1 transition-colors"
        >
          <ArrowUpRight className="size-3.5" />
        </a>
      </header>

      {!h.reachable ? (
        <div className="border-border/60 border-t px-3.5 py-4">
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            Prometheus unreachable — host metrics are off.
            {h.error ? <span className="text-destructive mt-1 block font-mono text-[10px]">{h.error}</span> : null}
          </p>
        </div>
      ) : (
        <>
          <div className="border-border/60 grid grid-cols-4 gap-1 border-t px-2.5 py-3.5">
            <Ring value={h.cpuPercent} label={`${Math.round(h.cpuPercent)}%`} caption="cpu" color={ringColor(h.cpuPercent)} />
            <Ring value={h.memPercent} label={`${Math.round(h.memPercent)}%`} caption="ram" color={ringColor(h.memPercent)} />
            <Ring value={h.diskPercent} label={`${Math.round(h.diskPercent)}%`} caption="disk" color={ringColor(h.diskPercent)} />
            <Ring
              value={(h.tempC / 100) * 100}
              label={`${Math.round(h.tempC)}°`}
              caption="cpu temp"
              color={ringColor(h.tempC)}
            />
          </div>

          <div className="border-border/60 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t px-3.5 py-3">
            <div className="space-y-1">
              <FieldLabel>Power</FieldLabel>
              <div className="field flex items-center gap-1.5 rounded-md px-2 py-1.5">
                <Zap className="text-accent size-3" />
                <span className="font-mono text-[13px] leading-none font-medium tabular-nums">{h.watts.toFixed(1)} W</span>
                <span className="text-muted-foreground ml-auto text-[9px]">est.</span>
              </div>
            </div>
            <div className="space-y-1">
              <FieldLabel>Load</FieldLabel>
              <div className="field flex items-center gap-1.5 rounded-md px-2 py-1.5">
                <span
                  className={cn(
                    "font-mono text-[13px] leading-none font-medium tabular-nums",
                    h.cores && h.load1 > h.cores ? "text-destructive" : "text-foreground",
                  )}
                >
                  {h.load1.toFixed(2)}
                </span>
                <span className="text-muted-foreground ml-auto text-[9px]">/ {h.cores} cpu</span>
              </div>
            </div>
            <div className="space-y-1">
              <FieldLabel>Network eno1</FieldLabel>
              <div className="field flex items-center gap-2 rounded-md px-2 py-1.5">
                <span className="inline-flex items-center gap-1 font-mono text-[11px] leading-none tabular-nums">
                  <ArrowDown className="text-secondary size-3" />
                  {h.rxLabel}
                </span>
                <span className="inline-flex items-center gap-1 font-mono text-[11px] leading-none tabular-nums">
                  <ArrowUp className="text-primary size-3" />
                  {h.txLabel}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <FieldLabel>Memory / uptime</FieldLabel>
              <div className="field flex items-center gap-1.5 rounded-md px-2 py-1.5">
                <span className="font-mono text-[11px] leading-none tabular-nums">
                  {h.memUsedLabel}/{h.memTotalLabel}
                </span>
                <span className="text-muted-foreground ml-auto font-mono text-[10px]">{h.uptimeLabel}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export const HostNode = memo(HostNodeImpl);
