import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  ArrowUpRight,
  Captions,
  ChevronRight,
  Cpu,
  Download,
  Film,
  Inbox,
  MemoryStick,
  MonitorPlay,
  Radar,
  Tv,
  type LucideIcon,
} from "lucide-react";
import { memo } from "react";

import { FieldLabel, MiniBar, STATUS_LABEL, StatusDot, TONE_TEXT } from "@/components/primitives";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ContainerLoad, Snapshot } from "@/lib/api";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  jellyseerr: Inbox,
  radarr: Film,
  sonarr: Tv,
  prowlarr: Radar,
  qbittorrent: Download,
  bazarr: Captions,
  jellyfin: MonitorPlay,
};

export type ServiceNodeData = {
  snapshot: Snapshot;
  load?: ContainerLoad;
  selected: boolean;
  onSelect: (id: string) => void;
};

export type ServiceFlowNode = Node<ServiceNodeData, "service">;

function ServiceNodeImpl({ data }: NodeProps<ServiceFlowNode>) {
  const { snapshot, load, selected, onSelect } = data;
  const Icon = ICONS[snapshot.id] ?? Inbox;
  const dead = snapshot.status === "down" || snapshot.status === "unconfigured";
  const activityCount = snapshot.activity?.length ?? 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(snapshot.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(snapshot.id);
        }
      }}
      className={cn(
        "panel w-[268px] cursor-pointer rounded-xl border text-left transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-primary/45",
        selected ? "border-primary/70 ring-primary/25 ring-2" : "border-border/70",
        dead && "opacity-75",
      )}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      {/* The availability edge runs right to left, against the pipeline. Given
          its own pair of handles underneath, it loops below the row instead of
          doubling back across every node. */}
      <Handle type="source" position={Position.Bottom} id="under" />
      <Handle type="target" position={Position.Bottom} id="under" />

      <header className="flex items-start gap-2 px-3 pt-2.5 pb-2">
        <ChevronRight className="text-muted-foreground mt-[3px] size-3 shrink-0" />
        <Icon className="text-primary mt-px size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] leading-tight font-semibold tracking-tight">{snapshot.name}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <StatusDot status={snapshot.status} />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {STATUS_LABEL[snapshot.status]}
                {snapshot.error ? ` — ${snapshot.error}` : ""}
                {snapshot.latencyMs != null ? ` · ${snapshot.latencyMs} ms` : ""}
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-muted-foreground truncate text-[10px] leading-tight">{snapshot.role}</p>
        </div>
        <a
          href={snapshot.link}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          title={`Open ${snapshot.name}`}
          className="text-muted-foreground hover:bg-muted hover:text-foreground -mt-0.5 -mr-1 rounded-md p-1 transition-colors"
        >
          <ArrowUpRight className="size-3.5" />
        </a>
      </header>

      <div className="border-border/60 border-t px-3 py-2.5">
        {snapshot.stats.length === 0 ? (
          <p className={cn("text-[11px]", dead ? "text-destructive" : "text-muted-foreground")}>
            {snapshot.error ?? "no data"}
          </p>
        ) : (
          <div className="space-y-2">
            {snapshot.stats.map((stat) => (
              <div key={stat.label} className="space-y-1">
                <FieldLabel>{stat.label}</FieldLabel>
                <div className="field flex items-baseline gap-2 rounded-md px-2 py-1.5">
                  <span className={cn("font-mono text-[13px] leading-none font-medium tabular-nums", TONE_TEXT[stat.tone ?? "default"])}>
                    {stat.value}
                  </span>
                  {stat.hint && (
                    <span className="text-muted-foreground ml-auto truncate text-[10px] leading-none">{stat.hint}</span>
                  )}
                </div>
                {stat.progress != null && <MiniBar value={stat.progress} tone={stat.tone ?? "accent"} />}
              </div>
            ))}
          </div>
        )}

        {snapshot.flags && snapshot.flags.length > 0 && (
          <div className="mt-2.5 space-y-1.5">
            {snapshot.flags.map((flag) => (
              <div key={flag.label} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground truncate text-[10px]">{flag.label}</span>
                <span
                  className={cn(
                    "relative h-3.5 w-7 shrink-0 rounded-full transition-colors",
                    flag.on ? "bg-primary" : "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "bg-background absolute top-0.5 size-2.5 rounded-full transition-all",
                      flag.on ? "left-[15px]" : "left-0.5",
                    )}
                  />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="text-muted-foreground border-border/60 flex items-center gap-3 border-t px-3 py-1.5 text-[10px]">
        {load && (
          <>
            <span className="inline-flex items-center gap-1" title="container CPU">
              <Cpu className="size-3" />
              {load.cpuPercent.toFixed(load.cpuPercent < 10 ? 1 : 0)}%
            </span>
            <span className="inline-flex items-center gap-1" title="container memory">
              <MemoryStick className="size-3" />
              {load.memLabel}
            </span>
          </>
        )}
        <span className="ml-auto truncate font-mono">
          {activityCount > 0 && snapshot.activityLabel ? `${activityCount} ${snapshot.activityLabel.toLowerCase()}` : snapshot.version ? `v${snapshot.version.split("-")[0]}` : ""}
        </span>
      </footer>
    </div>
  );
}

export const ServiceNode = memo(ServiceNodeImpl);
