import type { HostSummary } from "@wire";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { MetricRows, StatusDot, STATUS_LABEL, TONE_TEXT } from "@/components/primitives";
import { cn } from "@/lib/utils";

/** The compact form of a machine: status, role, and its metrics as rows rather
 *  than cards. Used for the second machine on the overview, where the first one
 *  gets the hero treatment. */
export function HostCard({ host, to }: { host: HostSummary; to?: string }) {
  return (
    <div className="neu flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={host.status} />
            <span className="text-lg font-medium tracking-tight">{host.name}</span>
            <span className={cn("text-[11px]", TONE_TEXT[host.status === "up" ? "good" : host.status === "warn" ? "warn" : "bad"])}>
              {STATUS_LABEL[host.status]}
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-sm" title={host.role}>
            {host.role}
          </p>
        </div>
        {to && (
          <Link
            to={to}
            aria-label={`Open ${host.name}`}
            className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-md transition-transform hover:scale-105 active:scale-95"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        )}
      </div>

      {host.error ? (
        <p className="text-tone-bad text-xs leading-snug">{host.error}</p>
      ) : (
        <MetricRows metrics={host.metrics} limit={5} />
      )}
    </div>
  );
}
