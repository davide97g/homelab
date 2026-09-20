import type { ChartSpec, ContainerDetail } from "@wire";
import { useEffect, useState } from "react";
import { Panel, type PanelSide } from "@/components/charts/time-series";
import { FieldLabel } from "@/components/primitives";
import { useCatalog } from "@/hooks/use-catalog";
import { useSeries, type Instance } from "@/hooks/use-series";
import { fetchContainers } from "@/lib/api";
import { cn } from "@/lib/utils";

// What an answer looks like once /api/ask has decided what was asked.
//
// Nothing here knows about the model. It takes a ChartSpec -- registry ids, a
// range, a machine -- and renders it with the same `Panel` and the same
// `useSeries` every metrics page uses. That is the point of resolving a question
// down to a spec: the answer is an ordinary part of the app, not a second chart
// stack that has to be kept in step with the first.

export function AskResult({ spec, className }: { spec: ChartSpec; className?: string }) {
  return spec.shape === "table" ? (
    <ServiceTable spec={spec} className={className} />
  ) : (
    <ChartAnswer spec={spec} className={className} />
  );
}

function machinesFor(spec: ChartSpec): Instance[] {
  return spec.instance === "both" ? ["homelab", "nas"] : [spec.instance];
}

function ChartAnswer({ spec, className }: { spec: ChartSpec; className?: string }) {
  const entryFor = useCatalog();
  const shown = machinesFor(spec);

  // Both called unconditionally and the unwanted one switched off, exactly as
  // MetricsPage does it -- asking about one machine must not query the other.
  const homelab = useSeries(spec.ids, spec.range, "homelab", shown.includes("homelab"));
  const nas = useSeries(spec.ids, spec.range, "nas", shown.includes("nas"));
  const state: Record<Instance, ReturnType<typeof useSeries>> = { homelab, nas };

  const error = shown.map((m) => state[m].error).find(Boolean) ?? null;

  return (
    <div className={cn("space-y-3", className)}>
      {error && <div className="neu text-tone-bad p-3 text-sm">{error}</div>}
      <div className={cn("grid gap-3", spec.ids.length > 1 && "xl:grid-cols-2")}>
        {spec.ids.map((id) => (
          <Panel
            key={id}
            entry={entryFor(id)}
            height={190}
            threshold={spec.threshold ?? null}
            sides={shown.map(
              (m): PanelSide => ({
                instance: m,
                frame: state[m].frame(id),
                startedAt: state[m].startedAt,
              }),
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** The ranked-list answer. Served from /api/containers rather than a series,
 *  because "the ten busiest services" is a question about right now and cAdvisor
 *  already answers it -- a topk over a range would be a different, slower and
 *  less accurate way of saying the same thing. */
function ServiceTable({ spec, className }: { spec: ChartSpec; className?: string }) {
  const [rows, setRows] = useState<ContainerDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchContainers(ac.signal)
      .then((res) => setRows(res.containers))
      .catch((err: unknown) => {
        if (!ac.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => ac.abort();
  }, []);

  if (error) return <div className={cn("neu text-tone-bad p-3 text-sm", className)}>{error}</div>;
  if (!rows) return <div className={cn("neu text-muted-foreground p-3 text-sm", className)}>Reading containers…</div>;

  const wanted = machinesFor(spec);
  const byMemory = spec.rankBy === "memory";
  const limit = spec.limit ?? 10;

  const ranked = rows
    .filter((r) => wanted.includes(r.instance))
    .filter((r) => (byMemory ? r.rssBytes !== null : r.cpuPercent !== null))
    .sort((a, b) => (byMemory ? (b.rssBytes ?? 0) - (a.rssBytes ?? 0) : (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0)))
    .slice(0, limit);

  if (ranked.length === 0) {
    return <div className={cn("neu text-muted-foreground p-3 text-sm", className)}>No containers to rank.</div>;
  }

  // The column being ranked on carries the bar; the other is plain text. Sharing
  // one scale across the visible rows makes the shape of the list readable
  // without anyone reading a single number.
  const peak = Math.max(...ranked.map((r) => (byMemory ? (r.rssBytes ?? 0) : r.cpuPercent ?? 0)), 1);

  return (
    <section className={cn("neu flex flex-col gap-2 p-4", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Top {ranked.length} by {byMemory ? "memory" : "CPU"}
        </h2>
        <FieldLabel>{spec.instance === "both" ? "both machines" : spec.instance}</FieldLabel>
      </div>

      <ol className="flex flex-col">
        {ranked.map((r, i) => {
          const value = byMemory ? (r.rssBytes ?? 0) : r.cpuPercent ?? 0;
          return (
            <li
              key={`${r.instance}:${r.name}`}
              className="border-border/60 grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 border-b py-1.5 last:border-b-0"
            >
              <span className="text-muted-foreground tnum text-[11px]">{i + 1}</span>
              <div className="min-w-0">
                <div className="truncate text-[13px]">{r.name}</div>
                <div className="bg-border/70 mt-1 h-px w-full overflow-hidden">
                  <div className="bg-primary h-px" style={{ width: `${Math.round((value / peak) * 100)}%` }} />
                </div>
              </div>
              <span className="tnum text-[13px] font-medium">
                {byMemory ? r.rssDisplay : `${r.cpuPercent?.toFixed(1) ?? "—"}%`}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
