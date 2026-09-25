import type { MediaNode } from "@wire";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  ArrowUpRight,
  BookOpen,
  Captions,
  Cpu,
  Download,
  Film,
  Inbox,
  Library,
  MemoryStick,
  MonitorPlay,
  Radar,
  Tv,
  type LucideIcon,
} from "lucide-react";
import { memo } from "react";
import { FieldLabel, MiniBar, STATUS_LABEL, StatusDot, TONE_TEXT } from "@/components/primitives";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  jellyseerr: Inbox,
  radarr: Film,
  sonarr: Tv,
  prowlarr: Radar,
  qbittorrent: Download,
  bazarr: Captions,
  jellyfin: MonitorPlay,
  suwayomi: Download,
  kavita: Library,
  yomu: BookOpen,
};

export type ServiceNodeData = {
  node: MediaNode;
  selected: boolean;
  onSelect: (id: string) => void;
};

export type ServiceFlowNode = Node<ServiceNodeData, "service">;

/** One card per service, and the same promise the rest of the hub makes: the
 *  stats are rendered generically, so putting a number on a node is a change in
 *  one collector and nothing here. */
function ServiceNodeImpl({ data }: NodeProps<ServiceFlowNode>) {
  const { node, selected, onSelect } = data;
  const Icon = ICONS[node.id] ?? Inbox;
  const quiet = node.status === "down" || node.status === "unconfigured";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(node.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
      className={cn(
        "neu w-[260px] cursor-pointer text-left transition-[transform,border-color] duration-200 motion-reduce:transition-none",
        "hover:-translate-y-0.5",
        "focus-visible:ring-ring/60 focus-visible:ring-2 focus-visible:outline-none",
        selected && "ring-ring/60 ring-2",
        quiet && "opacity-80",
      )}
    >
      {/* Left in, right out for the pipeline; a second pair underneath for the
          availability edge, which runs the other way and would otherwise double
          back across every node in the row. */}
      <Handle type="target" position={Position.Left} className="!border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!border-0 !bg-transparent" />
      <Handle type="source" position={Position.Bottom} id="under" className="!border-0 !bg-transparent" />
      <Handle type="target" position={Position.Bottom} id="under" className="!border-0 !bg-transparent" />

      <header className="flex items-start gap-2 px-3 pt-3 pb-2">
        <Icon className="text-primary mt-px size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] leading-tight font-semibold">{node.label}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <StatusDot status={node.status} />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {STATUS_LABEL[node.status]}
                {node.error ? ` — ${node.error}` : ""}
                {node.latencyMs != null ? ` · ${node.latencyMs} ms` : ""}
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-muted-foreground truncate text-[10px] leading-tight">{node.role}</p>
        </div>
        <a
          href={node.link}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => event.stopPropagation()}
          title={`Open ${node.label}`}
          className="text-muted-foreground hover:bg-muted hover:text-foreground -mt-0.5 -mr-1 rounded-md p-1 transition-colors"
        >
          <ArrowUpRight className="size-3.5" />
        </a>
      </header>

      <div className="border-border/60 border-t px-3 py-2.5">
        {node.stats.length === 0 ? (
          <p className={cn("text-[11px] leading-snug", quiet ? "text-tone-bad" : "text-muted-foreground")}>
            {node.error ?? "no data"}
          </p>
        ) : (
          <div className="grid gap-2">
            {node.stats.map((stat) => (
              <div key={stat.id} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <FieldLabel>{stat.label}</FieldLabel>
                  <span className={cn("tnum text-[12.5px] font-medium", TONE_TEXT[stat.tone ?? "default"])}>
                    {stat.value}
                  </span>
                </div>
                {stat.fraction !== undefined && <MiniBar value={stat.fraction} tone={stat.tone ?? "accent"} />}
                {stat.hint && (
                  <p className="text-muted-foreground truncate text-[10px] leading-tight" title={stat.hint}>
                    {stat.hint}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {node.flags.length > 0 && (
          <div className="mt-2.5 grid gap-1.5">
            {node.flags.map((flag) => (
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
        {node.load ? (
          <>
            <span className="inline-flex items-center gap-1" title="container CPU">
              <Cpu className="size-3" />
              <span className="tnum">{node.load.cpuPercent.toFixed(node.load.cpuPercent < 10 ? 1 : 0)}%</span>
            </span>
            <span className="inline-flex items-center gap-1" title="container memory">
              <MemoryStick className="size-3" />
              <span className="tnum">{node.load.rssDisplay}</span>
            </span>
          </>
        ) : (
          // Jellyfin runs on the NAS, so there is no row for it here. Saying so
          // beats printing a zero that would read as an idle container.
          <span className="truncate">{node.id === "jellyfin" ? "on the NAS" : ""}</span>
        )}
        <span className="ml-auto truncate font-mono">
          {node.activity.length > 0
            ? `${node.activity.length} ${node.activityLabel.toLowerCase()}`
            : node.version
              ? `v${node.version.split("-")[0]}`
              : ""}
        </span>
      </footer>
    </div>
  );
}

export const ServiceNode = memo(ServiceNodeImpl);
