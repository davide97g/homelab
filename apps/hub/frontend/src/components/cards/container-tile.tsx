import type { ContainerSummary } from "@wire";
import { Boxes } from "lucide-react";
import { FieldLabel, MiniBar } from "@/components/primitives";

/** Counted from cAdvisor, not the Docker API, so this covers both machines
 *  without a socket anywhere. The cost is that only running containers exist
 *  here: state, health and restart counts are Docker's to tell and arrive with
 *  the actions layer. */
export function ContainerTile({ containers }: { containers: ContainerSummary }) {
  const peak = Math.max(1, ...containers.top.map((c) => c.cpuPercent));

  return (
    <div className="neu flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Boxes className="text-muted-foreground size-4" />
          <FieldLabel>Busiest containers</FieldLabel>
        </div>
        <span className="text-muted-foreground tnum text-[11px]">
          {containers.total} running · {containers.byInstance.homelab} + {containers.byInstance.nas}
        </span>
      </div>

      {containers.top.length === 0 ? (
        <p className="text-muted-foreground text-xs">cAdvisor is not reporting any containers.</p>
      ) : (
        <div className="grid gap-2">
          {containers.top.map((c) => (
            <div key={`${c.instance}-${c.name}`} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[12px]" title={c.name}>
                  {c.name}
                </span>
                <span className="tnum text-muted-foreground shrink-0 text-[11px]">
                  {c.cpuPercent.toFixed(1)}% · {c.rssDisplay}
                </span>
              </div>
              <MiniBar value={c.cpuPercent / peak} tone="accent" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
