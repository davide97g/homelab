import type { Summary } from "@wire";
import { LogOut, RefreshCw } from "lucide-react";
import { useLocation } from "react-router-dom";
import { StatusDot } from "@/components/primitives";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Trace } from "@/components/shell/trace";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { refreshAll, useRefreshing } from "@/lib/activity";
import { shortTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { activeRoute } from "@/components/shell/sidebar";

export function TopBar({
  data,
  refreshedAt,
  loading,
  onSignOut,
}: {
  data: Summary | null;
  refreshedAt: number | null;
  loading: boolean;
  onSignOut: () => void;
}) {
  const { pathname } = useLocation();
  const route = activeRoute(pathname);
  const refreshing = useRefreshing();
  const firing = data?.alerts.filter((a) => a.state === "firing") ?? [];

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6">
      <h1 className="shrink-0 text-[15px] font-semibold tracking-tight">{route?.label ?? "Overview"}</h1>

      {/* The header's dead space, put to work. Sitting beside the timestamp and
          the button that triggers it is the whole reason it reads as this page
          being re-read rather than as an ornament. */}
      <div className="hidden min-w-0 flex-1 px-4 md:block">
        <Trace active={refreshing} height={24} />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {data && (
          <div className="hidden items-center gap-3 sm:flex">
            {(["homelab", "nas"] as const).map((id) => (
              <span key={id} className="flex items-center gap-1.5 text-xs">
                <StatusDot status={data.hosts[id].status} />
                <span className="text-muted-foreground">{data.hosts[id].name}</span>
              </span>
            ))}
          </div>
        )}

        {firing.length > 0 && (
          <span className="bg-tone-bad/12 text-tone-bad rounded-full px-2.5 py-1 text-[11px] font-medium">
            {firing.length} firing
          </span>
        )}

        {data?.stale && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="bg-tone-warn/15 text-tone-warn rounded-full px-2.5 py-1 text-[11px] font-medium">
                stale
              </span>
            </TooltipTrigger>
            <TooltipContent>A source missed its budget; showing the last good numbers.</TooltipContent>
          </Tooltip>
        )}

        <span className="text-muted-foreground tnum hidden text-[11px] sm:inline">
          {refreshedAt ? shortTime(new Date(refreshedAt).toISOString()) : "—"}
        </span>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh now"
          aria-busy={refreshing}
          disabled={refreshing}
          onClick={() => void refreshAll()}
        >
          <RefreshCw
            className={cn("size-4 transition-colors", (loading || refreshing) && "animate-spin", refreshing && "text-primary")}
          />
        </Button>
        <ThemeToggle />
        <Button variant="ghost" size="icon-sm" aria-label="Sign out" onClick={onSignOut}>
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
