import type { Summary } from "@wire";
import { Activity, LogOut, RefreshCw, Sparkles } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { StatusDot, STATUS_LABEL } from "@/components/primitives";
import { activeRoute } from "@/components/shell/sidebar";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Trace } from "@/components/shell/trace";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { refreshAll, useRefreshing } from "@/lib/activity";
import { shortTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The controls on the right are card-coloured tiles on the grey page, 44px
 *  everywhere -- a comfortable thumb target and, on a desk, the same size as
 *  the status pill beside them so the row reads as one strip. */
const TILE = "size-11 rounded-lg border-transparent bg-card shadow-none hover:bg-card/70";

/** One line for both machines: which of them is not fine, or that both are. */
function estateLine(data: Summary): { text: string; worst: Summary["hosts"]["homelab"]["status"] } {
  const hosts = [data.hosts.homelab, data.hosts.nas];
  const order = ["down", "warn", "unconfigured", "up"] as const;
  const worst = order.find((s) => hosts.some((h) => h.status === s)) ?? "up";
  if (worst === "up") return { text: "Both machines healthy", worst };
  const named = hosts.filter((h) => h.status === worst).map((h) => h.name);
  return { text: `${named.join(" and ")} ${STATUS_LABEL[worst]}`, worst };
}

export function TopBar({
  data,
  refreshedAt,
  loading,
  stuck,
  onSignOut,
  onAsk,
}: {
  data: Summary | null;
  refreshedAt: number | null;
  loading: boolean;
  /** The page has scrolled under the bar: it turns to glass. */
  stuck: boolean;
  onSignOut: () => void;
  onAsk: () => void;
}) {
  const { pathname } = useLocation();
  const route = activeRoute(pathname);
  const refreshing = useRefreshing();
  const firing = data?.alerts.filter((a) => a.state === "firing") ?? [];
  const estate = data ? estateLine(data) : null;
  const read = refreshedAt ? shortTime(new Date(refreshedAt).toISOString()) : null;
  const title = route?.label ?? "Overview";

  return (
    <header
      data-stuck={stuck || undefined}
      className={cn(
        "topbar relative z-20 flex shrink-0 items-center gap-2 sm:gap-3 transition-[background-color,box-shadow] duration-300",
        "px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 lg:mx-3 lg:mt-3 lg:rounded-xl lg:px-3 lg:pt-3 lg:pb-3",
      )}
    >
      <div className="mr-auto flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* Phones: the status pill does not fit, so its essentials ride above the title. */}
          {estate && (
            <span className="text-muted-foreground flex items-center gap-2 text-xs sm:hidden">
              <StatusDot status={estate.worst} className="size-2" />
              <span className="truncate">{estate.text}</span>
            </span>
          )}
          <h1
            key={title}
            className="animate-in fade-in-0 slide-in-from-bottom-1 truncate text-2xl font-medium tracking-tight duration-300 sm:text-3xl lg:text-4xl"
          >
            {title}
          </h1>
        </div>
      </div>

      {/* The header's dead space, put to work: the sweep runs while the page is
          being re-read, beside the timestamp and the button that triggers it. */}
      <div className="hidden min-w-24 flex-1 px-2 xl:block">
        <Trace active={refreshing} height={24} />
      </div>

      {estate && (
        <Link
          to="/overview"
          className="bg-card hover:bg-card/70 hidden h-11 items-center gap-3 rounded-lg py-1 pr-4 pl-1 transition-colors sm:flex"
        >
          <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-md">
            <Activity className="size-4" />
          </span>
          <span className="flex flex-col text-xs leading-tight">
            <span className="font-medium">{estate.text}</span>
            <span className="text-muted-foreground tnum">
              {data?.stale ? "stale · " : ""}read {read ?? "—"}
            </span>
          </span>
          <StatusDot status={estate.worst} />
        </Link>
      )}

      {firing.length > 0 && (
        <Link
          to="/overview"
          aria-label={`${firing.length} alerts firing`}
          className="bg-card text-tone-bad pop flex h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium"
        >
          <span className="bg-tone-bad size-2 rounded-full" />
          <span>
            {firing.length}
            <span className="hidden sm:inline"> firing</span>
          </span>
        </Link>
      )}

      <div className="flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-lg" className="size-11 rounded-lg" aria-label="Ask for a chart" onClick={onAsk}>
              <Sparkles className="transition-transform duration-300 group-hover/button:scale-110" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Ask for a chart — ⌘K</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-lg"
              className={TILE}
              aria-label="Refresh now"
              aria-busy={refreshing}
              disabled={refreshing}
              onClick={() => void refreshAll()}
            >
              <RefreshCw className={cn("transition-colors", (loading || refreshing) && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh now{read ? ` · last read ${read}` : ""}</TooltipContent>
        </Tooltip>

        <ThemeToggle className={TILE} />

        {/* On a phone sign-out lives in the More sheet; it is the least
            reached-for control and the row has no room to spare. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-lg"
              className={cn(TILE, "hidden lg:inline-flex")}
              aria-label="Sign out"
              onClick={onSignOut}
            >
              <LogOut />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sign out</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
