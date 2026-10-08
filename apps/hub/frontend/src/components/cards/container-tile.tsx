import type { ContainerSummary } from "@wire";
import { Boxes } from "lucide-react";
import { CardHeading, MiniBar } from "@/components/primitives";

/** Counted from cAdvisor, not the Docker API, so this covers both machines
 *  without a socket anywhere. The cost is that only running containers exist
 *  here: state, health and restart counts are Docker's to tell and arrive with
 *  the actions layer. */
export function ContainerTile({ containers }: { containers: ContainerSummary }) {
  const peak = Math.max(1, ...containers.top.map((c) => c.cpuPercent));

  return (
    <div className="neu flex flex-col gap-4 p-5">
      <CardHeading
        title="Busiest containers"
        subtitle={`${containers.total} running · ${containers.byInstance.homelab} + ${containers.byInstance.nas}`}
        action={
          <span className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-md">
            <Boxes className="size-4" />
          </span>
        }
      />

      {containers.top.length === 0 ? (
        <p className="text-muted-foreground text-sm">cAdvisor is not reporting any containers.</p>
      ) : (
        <div className="grid gap-2">
          {containers.top.map((c) => (
            <div key={`${c.instance}-${c.name}`} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm" title={c.name}>
                  {c.name}
                </span>
                <span className="tnum text-muted-foreground shrink-0 font-mono text-xs">
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
