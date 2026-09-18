import type { HostSummary } from "@wire";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { FieldLabel, HEALTH_TONE, MiniBar, StatusDot, STATUS_LABEL, TONE_TEXT } from "@/components/primitives";
import { cn } from "@/lib/utils";

/** The compact form of a machine: status, role, and its metrics as rows rather
 *  than cards. Used for the second machine on the overview, where the first one
 *  gets the hero treatment. */
export function HostCard({ host, to }: { host: HostSummary; to?: string }) {
  return (
    <div className="neu flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={host.status} />
            <span className="text-sm font-semibold">{host.name}</span>
            <span className={cn("text-[11px]", TONE_TEXT[host.status === "up" ? "good" : host.status === "warn" ? "warn" : "bad"])}>
              {STATUS_LABEL[host.status]}
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-[11px]" title={host.role}>
            {host.role}
          </p>
        </div>
        {to && (
          <Link
            to={to}
            aria-label={`Open ${host.name}`}
            className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        )}
      </div>

      {host.error ? (
        <p className="text-tone-bad text-xs leading-snug">{host.error}</p>
      ) : (
        <div className="grid gap-2.5">
          {host.metrics.slice(0, 5).map((m) => (
            <div key={m.id} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <FieldLabel>{m.label}</FieldLabel>
                <span className="tnum text-[13px] font-medium">{m.display}</span>
              </div>
              {m.fraction !== undefined && <MiniBar value={m.fraction} tone={HEALTH_TONE[m.health]} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
