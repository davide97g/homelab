import type { Range } from "@wire";
import { useState } from "react";
import { Panel } from "@/components/charts/time-series";
import { RangePicker } from "@/components/charts/range-picker";
import { useSeries } from "@/hooks/use-series";
import { cn } from "@/lib/utils";

export type PanelSpec = { id: string; wide?: boolean; height?: number };

/** Every metric page is the same thing: a range, a machine, and a grid of
 *  panels. Declaring them as a list of ids keeps a page to a few lines and means
 *  adding a panel is one entry here plus one in the server's registry. */
export function MetricsPage({
  panels,
  machines = ["homelab", "nas"],
  note,
}: {
  panels: PanelSpec[];
  machines?: ("homelab" | "nas")[];
  note?: string;
}) {
  const [range, setRange] = useState<Range>("6h");
  const [instance, setInstance] = useState<"homelab" | "nas">(machines[0] ?? "homelab");

  const { frame, error } = useSeries(
    panels.map((p) => p.id),
    range,
    instance,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {machines.length > 1 && (
          <div className="neu-inset flex gap-0.5 p-0.5" role="group" aria-label="Machine">
            {machines.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setInstance(m)}
                aria-pressed={m === instance}
                className={cn(
                  "rounded-[calc(var(--radius)-0.75rem)] px-3 py-1 text-[11px] font-medium transition-colors",
                  m === instance ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}
        <RangePicker value={range} onChange={setRange} />
        {note && <p className="text-muted-foreground text-[11px]">{note}</p>}
      </div>

      {error && <div className="neu text-tone-bad p-4 text-sm">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-2">
        {panels.map((p) => (
          <Panel
            key={p.id}
            frame={frame(p.id)}
            height={p.height}
            className={p.wide ? "xl:col-span-2" : undefined}
          />
        ))}
      </div>
    </div>
  );
}
