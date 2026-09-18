import type { Alert } from "@wire";
import { BellOff, TriangleAlert } from "lucide-react";
import { FieldLabel, TONE_TEXT } from "@/components/primitives";
import { sinceLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Read-only, and it stays that way.
 *
 *  There is no Alertmanager on the box, so these rules currently fire into
 *  nothing and this is the only place outside Grafana's rules page where they
 *  are visible. An acknowledge button whose state lived only in this process
 *  would be worse than no button: it would look like the alert was handled. */
export function AlertStrip({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="neu text-muted-foreground flex items-center gap-2.5 p-4 text-sm">
        <BellOff className="size-4 shrink-0" />
        <span>No alerts firing or pending.</span>
      </div>
    );
  }

  return (
    <div className="neu divide-border divide-y p-1">
      {alerts.map((a) => {
        const tone = a.severity === "critical" ? "bad" : "warn";
        return (
          <div key={`${a.name}-${a.instance ?? ""}-${a.since}`} className="flex items-start gap-3 px-3 py-2.5">
            <TriangleAlert className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[tone])} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{a.name}</span>
                {a.instance && <FieldLabel>{a.instance}</FieldLabel>}
                {a.state === "pending" && (
                  <span className="text-muted-foreground text-[10px]">pending</span>
                )}
              </div>
              <p className="text-muted-foreground text-xs leading-snug">{a.summary}</p>
            </div>
            <span className="text-muted-foreground tnum shrink-0 text-[11px]">{sinceLabel(a.since)}</span>
          </div>
        );
      })}
    </div>
  );
}
