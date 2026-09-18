import type { Summary } from "@wire";
import { LogOut, RefreshCw } from "lucide-react";
import { useLocation } from "react-router-dom";
import { StatusDot } from "@/components/primitives";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { shortTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { activeRoute } from "@/components/shell/sidebar";

export function TopBar({
  data,
  refreshedAt,
  loading,
  onRefresh,
  onSignOut,
}: {
  data: Summary | null;
  refreshedAt: number | null;
  loading: boolean;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const { pathname } = useLocation();
  const route = activeRoute(pathname);
  const firing = data?.alerts.filter((a) => a.state === "firing") ?? [];

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6">
      <h1 className="text-[15px] font-semibold tracking-tight">{route?.label ?? "Overview"}</h1>

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

        <Button variant="ghost" size="icon-sm" aria-label="Refresh now" onClick={onRefresh}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </Button>
        <ThemeToggle />
        <Button variant="ghost" size="icon-sm" aria-label="Sign out" onClick={onSignOut}>
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
