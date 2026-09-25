import type { Metric } from "@wire";
import { FieldLabel, HEALTH_TONE, MiniBar, TONE_TEXT } from "@/components/primitives";
import { cn } from "@/lib/utils";

/** One metric, rendered generically.
 *
 *  This is the convention worth keeping from mediarr-dash: pushing a `Metric`
 *  into `HostSummary.metrics` on the server is the entire change needed to put a
 *  new number on the page. There is no per-metric branch here and there should
 *  never be one -- anything a metric needs to say goes in `hint`, `fraction` or
 *  `health`. */
export function MetricCard({
  metric,
  surface = "glass",
  className,
}: {
  metric: Metric;
  surface?: "glass" | "neu";
  className?: string;
}) {
  const tone = HEALTH_TONE[metric.health];

  return (
    <div className={cn(surface === "glass" ? "glass" : "neu", "flex flex-col gap-2 p-4", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <FieldLabel>{metric.label}</FieldLabel>
        {metric.health !== "ok" && metric.health !== "unknown" && (
          <span className={cn("text-[10px] font-medium", TONE_TEXT[tone])}>
            {metric.health === "bad" ? "critical" : "high"}
          </span>
        )}
      </div>

      <div className="tnum text-[26px] leading-none font-semibold">{metric.display}</div>

      {metric.fraction !== undefined && <MiniBar value={metric.fraction} tone={tone} />}

      {metric.hint && (
        <p className="text-muted-foreground truncate text-[11px] leading-tight" title={metric.hint}>
          {metric.hint}
        </p>
      )}
    </div>
  );
}
