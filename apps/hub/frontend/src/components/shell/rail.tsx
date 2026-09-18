import {
  Boxes,
  Clapperboard,
  Cpu,
  HardDrive,
  LayoutDashboard,
  Network,
  ScrollText,
  Server,
  Wrench,
  Zap,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** One icon per domain, in the order you would actually walk a problem: what is
 *  it doing, what is it drawing, what is it moving, where is it writing, what is
 *  running, what did it say, then the two machine-specific pages and the
 *  controls.
 *
 *  A rail rather than a top nav because ten destinations is too many pills on a
 *  phone; the pills are kept for sub-views inside a page. */
export const ROUTES = [
  { to: "/", icon: LayoutDashboard, label: "Overview", end: true },
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

export function Rail() {
  return (
    <nav
      aria-label="Sections"
      className="bg-rail text-rail-foreground flex shrink-0 flex-row items-center gap-1 overflow-x-auto px-2 py-2 sm:h-full sm:w-14 sm:flex-col sm:gap-1.5 sm:overflow-visible sm:px-0 sm:py-3"
    >
      <div className="hidden sm:mb-2 sm:flex sm:size-9 sm:items-center sm:justify-center">
        <span className="bg-primary size-2.5 rounded-full" aria-hidden />
      </div>

      {ROUTES.map(({ to, icon: Icon, label, ...rest }) => (
        <Tooltip key={to}>
          <TooltipTrigger asChild>
            <NavLink
              to={to}
              end={"end" in rest ? rest.end : false}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  "relative flex size-9 shrink-0 items-center justify-center rounded-[10px] transition-colors",
                  "hover:bg-white/10 focus-visible:ring-primary/60 focus-visible:ring-2 focus-visible:outline-none",
                  isActive && "bg-white/12 text-primary",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="size-[18px]" strokeWidth={isActive ? 2.2 : 1.7} />
                  {isActive && (
                    <span className="bg-primary absolute top-1/2 -left-0.5 hidden h-5 w-[3px] -translate-y-1/2 rounded-r-full sm:block" />
                  )}
                </>
              )}
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}
