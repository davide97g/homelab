import type { HostSummary } from "@wire";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ArrowUpRight, Server } from "lucide-react";
import { memo } from "react";
import { FieldLabel, HEALTH_TONE, MiniBar, StatusDot } from "@/components/primitives";
import { cn } from "@/lib/utils";

export type HostNodeData = { host: HostSummary };
export type HostFlowNode = Node<HostNodeData, "host">;

// The four that answer "is the box the reason this is slow". The rest of the
// machine is one click away on /overview, which is where it belongs.
const SHOWN = ["cpu.total", "mem.percent", "temp.hottest", "fs.percent"];

/** The box itself, anchored to the left of the pipeline.
 *
 *  It does not take part in the pipeline; it carries it, which is what the faint
 *  dashed link says. Its numbers come from /api/summary — the payload the shell
 *  is already polling — and deliberately not from /api/media: one machine gets
 *  one source, or two pages end up disagreeing about the same CPU. */
function HostNodeImpl({ data }: NodeProps<HostFlowNode>) {
  const { host } = data;
  const metrics = SHOWN.map((id) => host.metrics.find((m) => m.id === id)).filter(
    (m): m is NonNullable<typeof m> => m !== undefined,
  );

  return (
    <div className="neu w-[216px]">
      <Handle type="source" position={Position.Right} className="!border-0 !bg-transparent" />

      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Server className="text-muted-foreground size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] leading-tight font-semibold">{host.name}</span>
            <StatusDot status={host.status} />
          </div>
          <p className="text-muted-foreground truncate text-[10px] leading-tight">carries the pipeline</p>
        </div>
        <a
          href="/overview"
          onClick={(event) => event.stopPropagation()}
          title="Open the machine overview"
          className="text-muted-foreground hover:bg-muted hover:text-foreground -mt-0.5 -mr-1 rounded-md p-1 transition-colors"
        >
          <ArrowUpRight className="size-3.5" />
        </a>
      </header>

      <div className="border-border/60 grid gap-2 border-t px-3 py-2.5">
        {metrics.length === 0 ? (
          <p className={cn("text-muted-foreground text-[11px]")}>{host.error ?? "no numbers right now"}</p>
        ) : (
          metrics.map((metric) => (
            <div key={metric.id} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <FieldLabel>{metric.label}</FieldLabel>
                <span className="tnum text-[12.5px] font-medium">{metric.display}</span>
              </div>
              {metric.fraction !== undefined && (
                <MiniBar value={metric.fraction} tone={HEALTH_TONE[metric.health]} />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export const HostNode = memo(HostNodeImpl);
