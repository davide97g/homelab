import { Activity, LogOut, RefreshCw } from "lucide-react";

import { TONE_BAR } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Overview } from "@/lib/api";
import { cn } from "@/lib/utils";

function Tally({ count, tone, label }: { count: number; tone: keyof typeof TONE_BAR; label: string }) {
  if (count === 0) return null;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px]">
      <span className={cn("size-1.5 rounded-full", TONE_BAR[tone])} />
      <span className="text-foreground font-mono tabular-nums">{count}</span>
      {label}
    </span>
  );
}

export function TopBar({
  data,
  refreshedAt,
  loading,
  error,
  onRefresh,
  onLogout,
}: {
  data: Overview | null;
  refreshedAt: number | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="border-border/60 bg-background/70 relative z-30 flex h-14 shrink-0 items-center gap-4 border-b px-4 backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <span className="bg-primary/15 text-primary flex size-7 items-center justify-center rounded-lg">
          <Activity className="size-4" />
        </span>
        <div className="leading-tight">
          <h1 className="text-[13px] font-semibold tracking-tight">mediarr pipeline</h1>
          <p className="text-muted-foreground font-mono text-[10px]">{data?.host.name ?? "homelab"}</p>
        </div>
      </div>

      <div className="ml-2 hidden items-center gap-4 sm:flex">
        <Tally count={data?.summary.up ?? 0} tone="good" label="healthy" />
        <Tally count={data?.summary.warn ?? 0} tone="warn" label="degraded" />
        <Tally count={data?.summary.down ?? 0} tone="bad" label="down" />
        <Tally count={data?.summary.unconfigured ?? 0} tone="default" label="unconfigured" />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {error && <span className="text-destructive max-w-64 truncate font-mono text-[10px]">{error}</span>}
        <span className="text-muted-foreground hidden font-mono text-[10px] md:inline">
          {refreshedAt ? new Date(refreshedAt).toLocaleTimeString() : "—"}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onRefresh} aria-label="Refresh now">
              <RefreshCw className={cn(loading && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh now — auto every 5 s</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onLogout} aria-label="Sign out">
              <LogOut />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sign out</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
