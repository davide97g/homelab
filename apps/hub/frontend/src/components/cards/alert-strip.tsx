import type { Alert } from "@wire";
import { ArrowRight, BellOff } from "lucide-react";
import { Link } from "react-router-dom";
import { FieldLabel, TONE_BG, TONE_TEXT } from "@/components/primitives";
import { sinceLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Read-only, and it stays that way.
 *
 *  There is no Alertmanager on the box, so these rules currently fire into
 *  nothing and this is the only place outside Grafana's rules page where they
 *  are visible. An acknowledge button whose state lived only in this process
 *  would be worse than no button: it would look like the alert was handled. */
export function AlertStrip({ alerts, limit }: { alerts: Alert[]; /** Rows shown before a link to the rest. */ limit?: number }) {
  const shown = limit === undefined ? alerts : alerts.slice(0, limit);
  const hidden = alerts.length - shown.length;
  if (alerts.length === 0) {
    return (
      <div className="neu text-muted-foreground flex items-center gap-2.5 p-4 text-sm">
        <BellOff className="size-4 shrink-0" />
        <span>No alerts firing or pending.</span>
      </div>
    );
  }

  return (
    <div className="neu divide-border divide-y px-5 py-1">
      {shown.map((a, i) => {
        const tone = a.severity === "critical" ? "bad" : "warn";
        return (
          // autocratico's "keep an eye on" row: a bar in the severity's colour,
          // the name and what it said, and how long in a tinted pill.
          <div
            key={`${a.name}-${a.instance ?? ""}-${a.since}`}
            className="rise-in flex items-center gap-3 py-3"
            style={{ "--i": i } as React.CSSProperties}
          >
            <span className={cn("h-9 w-1 shrink-0 rounded-full", TONE_BG[tone])} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium">{a.name}</span>
                {a.instance && <FieldLabel>{a.instance}</FieldLabel>}
                {a.state === "pending" && <span className="text-muted-foreground text-xs">pending</span>}
              </div>
              <p className="text-muted-foreground truncate text-xs leading-snug" title={a.summary}>
                {a.summary}
              </p>
            </div>
            <span
              className={cn(
                "tnum flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-xs",
                tone === "bad" ? "bg-tone-bad/12" : "bg-tone-warn/15",
                TONE_TEXT[tone],
              )}
            >
              <span className={cn("size-1.5 rounded-full", TONE_BG[tone])} />
              {sinceLabel(a.since)}
            </span>
          </div>
        );
      })}
      {hidden > 0 && (
        <Link
          to="/overview"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 py-3 text-xs font-medium transition-colors"
        >
          {hidden} more on the overview
          <ArrowRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}
