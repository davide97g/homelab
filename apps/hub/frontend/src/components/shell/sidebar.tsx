import {
  Boxes,
  Clapperboard,
  Cpu,
  HardDrive,
  LayoutDashboard,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Server,
  Waypoints,
  Wrench,
  Zap,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** One icon per domain, in the order you would actually walk a problem: where
 *  everything is and how it is connected, then what one machine is doing, what
 *  it is drawing, what it is moving, where it is writing, what is running, what
 *  it said, then the two machine-specific pages and the controls. */
export const ROUTES = [
  { to: "/", icon: Waypoints, label: "Topology" },
  { to: "/overview", icon: LayoutDashboard, label: "Overview" },
  { to: "/compute", icon: Cpu, label: "Compute & thermals" },
  { to: "/power", icon: Zap, label: "Power & energy" },
  { to: "/network", icon: Network, label: "Network" },
  { to: "/storage", icon: HardDrive, label: "Storage" },
  { to: "/containers", icon: Boxes, label: "Containers" },
  { to: "/logs", icon: ScrollText, label: "Logs" },
  { to: "/media", icon: Clapperboard, label: "Media pipeline" },
  { to: "/nas", icon: Server, label: "NAS" },
  { to: "/actions", icon: Wrench, label: "Actions" },
] as const;

const STORAGE_KEY = "hub.sidebar";

/** Read once at module load: the sidebar must be the right width on the first
 *  paint, not snap into place a frame later. */
export function initialExpanded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "collapsed";
  } catch {
    return true;
  }
}

/** The sidebar, which used to be a 56 px strip of unlabelled icons.
 *
 *  Icons alone are a memory test: `Zap` is power and `Network` is network, but
 *  nothing distinguishes "the box" from "the NAS" until you have clicked both.
 *  Expanded is the default and the names are the point; collapsed is there for
 *  when the charts want the width back, and keeps the tooltips that were
 *  carrying the whole thing before.
 *
 *  Ten destinations is too many pills on a phone, so below `sm` this is a
 *  horizontal scroller instead, where the labels ride along with the icons. */
/** Which rail entry a path belongs to. Shared with the top bar so the heading
 *  and the highlight can never disagree about where you are. */
export function activeRoute(pathname: string): (typeof ROUTES)[number] | undefined {
  return ROUTES.find((r) => (r.to === "/" ? pathname === "/" : pathname === r.to || pathname.startsWith(`${r.to}/`)));
}

export function Sidebar({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { pathname } = useLocation();
  const current = activeRoute(pathname);

  return (
    <nav
      aria-label="Sections"
      className={cn(
        "bg-rail text-rail-foreground flex shrink-0 flex-row items-center gap-1 overflow-x-auto px-2 py-2",
        "sm:h-full sm:flex-col sm:items-stretch sm:gap-1 sm:overflow-x-visible sm:overflow-y-auto sm:px-2 sm:py-3",
        "sm:transition-[width] sm:duration-200 sm:ease-out",
        expanded ? "sm:w-[216px]" : "sm:w-[60px]",
      )}
    >
      <div className="mb-1 hidden shrink-0 items-center gap-2.5 overflow-hidden px-2 py-1 sm:flex">
        <span className="bg-primary size-2.5 shrink-0 rounded-full" aria-hidden />
        <span
          className={cn(
            "min-w-0 truncate text-[13px] font-semibold tracking-tight transition-opacity duration-200",
            !expanded && "opacity-0",
          )}
        >
          homelab hub
        </span>
      </div>

      {ROUTES.map(({ to, icon: Icon, label }) => {
        const isActive = current?.to === to;

        // `isActive` is computed here rather than taken from NavLink's render
        // props on purpose. Radix's `asChild` clones this element to make it the
        // tooltip trigger, and cloning merges `className` by joining strings --
        // hand it a function and it joins the function's *source*, which is how
        // the rail spent its whole life with no visible active state.
        const item = (
          <Link
            to={to}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex h-9 shrink-0 items-center gap-2.5 overflow-hidden rounded-[10px] px-2.5",
              "transition-[background-color,color,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100",
              "hover:bg-white/10 focus-visible:ring-primary/60 focus-visible:ring-2 focus-visible:outline-none",
              !expanded && "sm:mx-auto sm:w-9 sm:justify-center sm:gap-0 sm:px-0",
              isActive && "bg-white/12 text-primary",
            )}
          >
            <Icon className="size-[18px] shrink-0" strokeWidth={isActive ? 2.2 : 1.7} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] transition-opacity duration-200",
                !expanded && "sm:w-0 sm:flex-none sm:opacity-0",
              )}
            >
              {label}
            </span>
            {isActive && (
              <span className="bg-primary animate-in fade-in-0 slide-in-from-left-1 absolute top-1/2 left-0 hidden h-5 w-[3px] -translate-y-1/2 rounded-r-full duration-200 sm:block" />
            )}
          </Link>
        );

        // A tooltip repeating a label you can already read is noise, so it only
        // exists in the state where the label does not.
        return expanded ? (
          <div key={to} className="contents">
            {item}
          </div>
        ) : (
          <Tooltip key={to}>
            <TooltipTrigger asChild>{item}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        );
      })}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse the sidebar" : "Expand the sidebar"}
        className={cn(
          "mt-auto hidden h-9 shrink-0 items-center gap-2.5 overflow-hidden rounded-[10px] px-2.5 sm:flex",
          "transition-[background-color,color,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100",
          "text-rail-foreground/55 hover:text-rail-foreground hover:bg-white/10",
          "focus-visible:ring-primary/60 focus-visible:ring-2 focus-visible:outline-none",
          !expanded && "sm:mx-auto sm:w-9 sm:justify-center sm:gap-0 sm:px-0",
        )}
      >
        {expanded ? (
          <PanelLeftClose className="size-[18px] shrink-0" strokeWidth={1.7} />
        ) : (
          <PanelLeftOpen className="size-[18px] shrink-0" strokeWidth={1.7} />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left text-[13px] transition-opacity duration-200",
            !expanded && "sm:w-0 sm:flex-none sm:opacity-0",
          )}
        >
          Collapse
        </span>
      </button>
    </nav>
  );
}

export function rememberSidebar(expanded: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, expanded ? "expanded" : "collapsed");
  } catch {
    // A browser that refuses storage still gets a working sidebar, it just
    // forgets the choice between visits.
  }
}
