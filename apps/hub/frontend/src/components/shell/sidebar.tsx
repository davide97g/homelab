import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { Summary } from "@wire";
import {
  ArrowUp,
  Boxes,
  Clapperboard,
  Cpu,
  Ellipsis,
  HardDrive,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Network,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Server,
  Sparkles,
  Waypoints,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { StatusDot, STATUS_LABEL } from "@/components/primitives";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Group = "estate" | "metrics" | "services" | "control";

const GROUP_LABEL: Record<Group, string> = {
  estate: "Estate",
  metrics: "Metrics",
  services: "Services",
  control: "Control",
};

/** One icon per domain, in the order you would actually walk a problem: where
 *  everything is and how it is connected, then what one machine is doing, what
 *  it is drawing, what it is moving, where it is writing, what is running, what
 *  it said, then the two machine-specific pages and the controls. The groups
 *  are the same walk with headings on it. */
export const ROUTES = [
  { to: "/", icon: Waypoints, label: "Topology", group: "estate" },
  { to: "/atlas", icon: Orbit, label: "Atlas", group: "estate" },
  { to: "/overview", icon: LayoutDashboard, label: "Overview", group: "estate" },
  { to: "/compute", icon: Cpu, label: "Compute & thermals", group: "metrics" },
  { to: "/power", icon: Zap, label: "Power & energy", group: "metrics" },
  { to: "/network", icon: Network, label: "Network", group: "metrics" },
  { to: "/storage", icon: HardDrive, label: "Storage", group: "metrics" },
  { to: "/containers", icon: Boxes, label: "Containers", group: "services" },
  { to: "/logs", icon: ScrollText, label: "Logs", group: "services" },
  { to: "/media", icon: Clapperboard, label: "Media pipeline", group: "services" },
  { to: "/nas", icon: Server, label: "NAS", group: "services" },
  { to: "/actions", icon: Wrench, label: "Actions", group: "control" },
  { to: "/ask", icon: Sparkles, label: "Pinned answers", group: "control" },
] as const satisfies readonly { to: string; icon: LucideIcon; label: string; group: Group }[];

type Route = (typeof ROUTES)[number];

const GROUPS: Group[] = ["estate", "metrics", "services", "control"];

/** Which entry a path belongs to. Shared with the top bar so the heading and
 *  the highlight can never disagree about where you are. */
export function activeRoute(pathname: string): Route | undefined {
  return ROUTES.find((r) => (r.to === "/" ? pathname === "/" : pathname === r.to || pathname.startsWith(`${r.to}/`)));
}

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

export function rememberSidebar(expanded: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, expanded ? "expanded" : "collapsed");
  } catch {
    // A browser that refuses storage still gets a working sidebar, it just
    // forgets the choice between visits.
  }
}

/** A highlight that slides to the active entry of a list instead of jumping:
 *  the container's ref and the highlight's style, measured from the item marked
 *  `data-active`. The first placement does not slide in from the corner. */
function useSlidingHighlight<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [moved, setMoved] = useState(false);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>("[data-active]");
      if (!el || !el.offsetParent) return setBox(null);
      setBox((before) => {
        const next = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
        if (before && before.x === next.x && before.y === next.y && before.w === next.w && before.h === next.h)
          return before;
        if (before) setMoved(true);
        return next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measured when the active entry or the layout changes
  }, deps);

  const style: React.CSSProperties = box
    ? { transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }
    : { opacity: 0 };
  return [ref, style, moved] as const;
}

function NavItem({ route, active, compact }: { route: Route; active: boolean; compact: boolean }) {
  const { to, icon: Icon, label } = route;

  // `active` is computed by the caller rather than taken from NavLink's render
  // props on purpose. Radix's `asChild` clones this element to make it the
  // tooltip trigger, and cloning merges `className` by joining strings -- hand
  // it a function and it joins the function's *source*.
  const item = (
    <Link
      to={to}
      aria-label={compact ? label : undefined}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
      className={cn(
        "group/nav relative z-10 flex h-9 shrink-0 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none",
        "transition-colors duration-200 focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        active ? "text-primary-foreground" : "text-foreground/80 hover:bg-muted hover:text-foreground",
        compact && "size-10 justify-center px-0",
      )}
    >
      <Icon className="size-4 shrink-0 transition-transform duration-200 group-hover/nav:scale-110 group-active/nav:scale-95" />
      {!compact && <span className="min-w-0 truncate">{label}</span>}
    </Link>
  );

  // A tooltip repeating a label you can already read is noise, so it only
  // exists in the state where the label does not.
  if (!compact) return item;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{item}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The black panel at the foot of the sidebar: ask for a chart from here.
 *  A question typed here opens the composer already answering it. */
function AskPanel({ onAsk }: { onAsk: (question?: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="ink relative flex shrink-0 flex-col gap-3 overflow-hidden rounded-lg p-3.5">
      <span className="chrome-orb absolute -top-5 -right-5 size-16 opacity-80" aria-hidden />
      <span className="relative flex items-center gap-2 pr-8 text-sm font-medium">
        <Sparkles className="size-4" />
        Ask for a chart
      </span>
      <form
        className="bg-foreground/10 ring-foreground/10 focus-within:ring-foreground/40 relative flex items-center gap-1 rounded-md p-1 pl-2.5 ring-1 transition-shadow"
        onSubmit={(e) => {
          e.preventDefault();
          const q = draft.trim();
          onAsk(q || undefined);
          setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="power this week…"
          aria-label="Ask for a chart"
          className="placeholder:text-foreground/45 h-7 min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
        <Button
          type="submit"
          size="icon-xs"
          variant="secondary"
          aria-label="Ask"
          className={cn("shrink-0 transition-[opacity,scale]", !draft.trim() && "scale-90 opacity-60")}
        >
          <ArrowUp />
        </Button>
      </form>
      <span className="text-foreground/60 relative flex items-center gap-1.5 text-xs">
        or press
        <kbd className="bg-foreground/10 rounded px-1 font-mono text-[10px]">⌘K</kbd>
        anywhere
      </span>
    </div>
  );
}

/** Desktop: the floating card on the left. Grouped sections with a black pill
 *  that slides to the page you are on, the ask panel, and the two machines. */
export function Sidebar({
  data,
  expanded,
  onToggle,
  onAsk,
}: {
  data: Summary | null;
  expanded: boolean;
  onToggle: () => void;
  onAsk: (question?: string) => void;
}) {
  const { pathname } = useLocation();
  const current = activeRoute(pathname);
  const compact = !expanded;
  const [navRef, highlight, slides] = useSlidingHighlight<HTMLElement>([current?.to, compact]);

  return (
    <aside
      className={cn(
        "bg-card flex h-full min-w-0 flex-col gap-5 rounded-xl p-4 transition-[width] duration-300 ease-(--ease-out-expo)",
        compact ? "w-18 items-center px-3 py-5" : "w-60 p-5",
      )}
    >
      <div className={cn("flex shrink-0 items-center gap-3 px-1", compact && "flex-col px-0")}>
        <Logo />
        {!compact && <span className="mr-auto text-sm font-semibold tracking-tight">homelab hub</span>}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse the sidebar" : "Expand the sidebar"}
            >
              {expanded ? <PanelLeftClose /> : <PanelLeftOpen />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{expanded ? "Collapse" : "Expand"}</TooltipContent>
        </Tooltip>
      </div>

      {/* Scrolls on its own when the window is short, so the panel and the
          machines below always fit. */}
      <nav
        ref={navRef}
        aria-label="Sections"
        className="no-scrollbar relative -mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 py-0.5"
      >
        <span
          aria-hidden
          className={cn(
            "bg-primary pointer-events-none absolute top-0 left-0 rounded-lg shadow-sm",
            slides && "transition-[transform,width,height,opacity] duration-300 ease-(--ease-out-expo)",
          )}
          style={highlight}
        />
        {GROUPS.map((g) => (
          <div key={g} className={cn("flex flex-col gap-0.5", compact && "items-center")}>
            <span className={cn("text-muted-foreground px-3 pb-1 text-xs", compact && "sr-only")}>
              {GROUP_LABEL[g]}
            </span>
            {ROUTES.filter((r) => r.group === g).map((r) => (
              <NavItem key={r.to} route={r} active={current?.to === r.to} compact={compact} />
            ))}
          </div>
        ))}
      </nav>

      <div className={cn("flex shrink-0 flex-col gap-4", compact && "items-center")}>
        {compact ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-lg" variant="secondary" className="size-10 rounded-lg" onClick={() => onAsk()} aria-label="Ask for a chart">
                <Sparkles />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Ask for a chart (⌘K)</TooltipContent>
          </Tooltip>
        ) : (
          <AskPanel onAsk={onAsk} />
        )}

        {data && (
          <div className={cn("flex flex-col gap-2 border-t pt-4", compact && "items-center border-t-0 pt-0")}>
            {(["homelab", "nas"] as const).map((id) => {
              const host = data.hosts[id];
              const row = (
                <Link
                  key={id}
                  to={id === "nas" ? "/nas" : "/overview"}
                  className="hover:bg-muted -mx-1 flex items-center gap-2.5 rounded-md px-1 py-1 transition-colors"
                  aria-label={compact ? `${host.name}: ${STATUS_LABEL[host.status]}` : undefined}
                >
                  <StatusDot status={host.status} />
                  {!compact && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{host.name}</span>
                      <span className="text-muted-foreground text-xs">{STATUS_LABEL[host.status]}</span>
                    </>
                  )}
                </Link>
              );
              return compact ? (
                <Tooltip key={id}>
                  <TooltipTrigger asChild>{row}</TooltipTrigger>
                  <TooltipContent side="right">
                    {host.name} · {STATUS_LABEL[host.status]}
                  </TooltipContent>
                </Tooltip>
              ) : (
                row
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

/** The four a phone reaches for: the map, the numbers, what the box said, and
 *  the switches. Everything else is one tap away under More. */
const TABS = ["/", "/overview", "/logs", "/actions"] as const;
const MORE = ROUTES.filter((r) => !(TABS as readonly string[]).includes(r.to));

/** Phones and tablets: a floating tab bar above the home indicator, the rest of
 *  the sections in a sheet that rises from the bottom. */
export function TabBar({ onSignOut }: { onSignOut: () => void }) {
  const { pathname } = useLocation();
  const current = activeRoute(pathname);
  const [more, setMore] = useState(false);
  const inMore = MORE.some((r) => r.to === current?.to);
  const [barRef, highlight, slides] = useSlidingHighlight<HTMLDivElement>([current?.to, more]);

  // A tap on a sheet entry navigates; the sheet goes with it.
  useEffect(() => setMore(false), [pathname]);

  const tabClass = (active: boolean) =>
    cn(
      "relative z-10 flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[0.68rem] font-medium outline-none",
      "transition-[color,scale] duration-200 select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95",
      active ? "text-primary-foreground" : "text-muted-foreground",
    );
  const tabBody = (Icon: LucideIcon, label: string, active: boolean) => (
    <>
      <Icon className={cn("size-5 transition-transform duration-300 ease-(--ease-spring)", active && "-translate-y-px scale-110")} />
      <span className="max-w-full truncate px-1">{label}</span>
    </>
  );

  return (
    <>
      {/* The fade under the bar hides the page scrolling beneath it, down to
          the home indicator. */}
      <nav
        aria-label="Sections"
        className="from-background pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-linear-to-t from-70% to-transparent px-4 pt-4 pb-safe lg:hidden"
      >
        <div
          ref={barRef}
          className="bg-card/85 ring-glass-border pointer-events-auto relative mx-auto mb-2 flex h-16 max-w-lg gap-1 rounded-2xl p-1.5 shadow-lg ring-1 backdrop-blur-xl"
        >
          <span
            aria-hidden
            className={cn(
              "bg-primary pointer-events-none absolute top-0 left-0 rounded-xl",
              slides && "transition-[transform,width,opacity] duration-300 ease-(--ease-out-expo)",
            )}
            style={highlight}
          />
          {TABS.map((to) => {
            const r = ROUTES.find((x) => x.to === to)!;
            const active = current?.to === to && !more;
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                data-active={active || undefined}
                className={tabClass(active)}
              >
                {tabBody(r.icon, r.label, active)}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMore(true)}
            data-active={inMore || more || undefined}
            className={tabClass(inMore || more)}
          >
            {tabBody(Ellipsis, "More", inMore || more)}
          </button>
        </div>
      </nav>

      <DialogPrimitive.Root open={more} onOpenChange={setMore}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/40 lg:hidden" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className={cn(
              "bg-card fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl pb-safe shadow-xl lg:hidden",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom duration-300",
            )}
          >
            <span aria-hidden className="bg-muted-foreground/30 absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full" />
            <DialogPrimitive.Title className="px-5 pt-6 pb-1 text-lg font-medium tracking-tight">More</DialogPrimitive.Title>
            <div className="flex flex-col gap-1 overflow-y-auto px-3 py-2">
              {MORE.map((r, i) => {
                const active = current?.to === r.to;
                return (
                  <Link
                    key={r.to}
                    to={r.to}
                    onClick={() => setMore(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rise-in flex h-12 shrink-0 items-center gap-3 rounded-xl px-3 text-base font-medium outline-none transition-colors",
                      "focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      active ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <r.icon className="size-5" />
                    {r.label}
                  </Link>
                );
              })}
            </div>
            <div className="mx-5 mt-2 mb-4 flex items-center border-t pt-4">
              <Button variant="ghost" className="text-muted-foreground -ml-3 h-11 gap-3 px-3 text-sm" onClick={onSignOut}>
                <LogOut className="size-4" />
                Sign out
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
