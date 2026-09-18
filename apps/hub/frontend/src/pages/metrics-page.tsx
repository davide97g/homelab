import type { HostSummary, Range, Summary } from "@wire";
import { useState } from "react";
import { Panel, type PanelSide } from "@/components/charts/time-series";
import { RangePicker } from "@/components/charts/range-picker";
import { StatusDot } from "@/components/primitives";
import { useCatalog } from "@/hooks/use-catalog";
import { useSeries, type Instance } from "@/hooks/use-series";
import { cn } from "@/lib/utils";

export type PanelSpec = { id: string; wide?: boolean; height?: number };

/** Which machines the grid is showing. Not a toggle: the two boxes answer the
 *  same questions differently and the interesting reading is usually the
 *  difference, so both at once is the default and one alone is the zoom. */
type View = Instance | "both";

/** Every metric page is the same thing: a range, the machines, and a grid of
 *  panels. Declaring them as a list of ids keeps a page to a few lines and means
 *  adding a panel is one entry here plus one in the server's registry. */
export function MetricsPage({
  data,
  panels,
  machines = ["homelab", "nas"],
  note,
}: {
  /** Only needed for the machine headers, so a single-machine page — the NAS
   *  page embeds one of these — does not have to carry the summary around. */
  data?: Summary;
  panels: PanelSpec[];
  machines?: Instance[];
  note?: string;
}) {
  const [range, setRange] = useState<Range>("6h");
  const [view, setView] = useState<View>(machines.length > 1 ? "both" : (machines[0] ?? "homelab"));
  const entryFor = useCatalog();

  const ids = panels.map((p) => p.id);
  const shown: Instance[] = machines.filter((m) => view === "both" || view === m);

  // Both hooks are called unconditionally — hooks always are — and the hidden
  // one is switched off rather than skipped, so isolating a machine really does
  // stop asking Prometheus about the other.
  const homelab = useSeries(ids, range, "homelab", shown.includes("homelab"));
  const nas = useSeries(ids, range, "nas", shown.includes("nas"));
  const state: Record<Instance, ReturnType<typeof useSeries>> = { homelab, nas };

  const paired = machines.length > 1 && data !== undefined;
  const expected = shown.length * ids.length;
  const outstanding = shown.reduce((n, m) => n + state[m].pending.size, 0);
  const error = shown.map((m) => state[m].error).find(Boolean) ?? null;
  const compare = shown.length > 1;

  return (
    <div className="space-y-4">
      {/* One sticky instrument header. The range, the machines and how much of
          the page is still arriving all belong together, and all three stay
          reachable however far down a long grid you have scrolled. */}
      <div
        className={cn(
          "space-y-3",
          // Only the full metric pages pin their controls. On the NAS page this
          // grid is one section among several and a floating range picker would
          // be sticking to someone else's heading.
          paired && "bg-background/88 sticky top-0 z-20 -mx-4 px-4 pt-1 backdrop-blur sm:-mx-6 sm:px-6",
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <RangePicker value={range} onChange={setRange} />
          {note && <p className="text-muted-foreground max-w-prose text-[11px]">{note}</p>}
        </div>

        {paired && data && (
          <MachineHeader hosts={data.hosts} machines={machines} view={view} onView={setView} />
        )}

        <Progress done={expected - outstanding} total={expected} />
      </div>

      {error && <div className="neu text-tone-bad p-4 text-sm">{error}</div>}

      <div className={cn("grid gap-4", !compare && "xl:grid-cols-2")}>
        {panels.map((p) => (
          <Panel
            key={p.id}
            entry={entryFor(p.id)}
            height={p.height}
            className={!compare && p.wide ? "xl:col-span-2" : undefined}
            sides={shown.map(
              (m): PanelSide => ({
                instance: m,
                frame: state[m].frame(p.id),
                startedAt: state[m].startedAt,
              }),
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** How much of the page is still in flight, as one hairline under the controls.
 *
 *  A cold window is a dozen Prometheus range queries and they land unevenly, so
 *  "loading" is a fraction rather than a yes or no. It fades out rather than
 *  vanishing, because a bar that disappears the instant it fills never got to
 *  say that it finished. */
function Progress({ done, total }: { done: number; total: number }) {
  const complete = total === 0 || done >= total;
  return (
    <div className="bg-border/70 h-px w-full overflow-hidden" aria-hidden>
      <div
        className={cn("bg-primary h-px transition-[width,opacity] duration-300 ease-out", complete && "opacity-0")}
        style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }}
      />
    </div>
  );
}

/** The two columns' headers, which are also how you isolate one of them.
 *
 *  Clicking a machine drops the other and gives this one the full width; the
 *  chips on the right of an isolated header are the way back, so nothing is ever
 *  more than one click from anything else. */
function MachineHeader({
  hosts,
  machines,
  view,
  onView,
}: {
  hosts: Record<Instance, HostSummary>;
  machines: Instance[];
  view: View;
  onView: (next: View) => void;
}) {
  if (view !== "both") {
    const host = hosts[view];
    const others = machines.filter((m) => m !== view);
    return (
      <div className="flex items-center gap-3">
        <Column host={host} active onClick={() => onView("both")} hint="Show both machines" />
        <div className="flex shrink-0 gap-1.5">
          {others.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onView(m)}
              title={`Show only ${hosts[m].name}`}
              className="neu-inset text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-[10px] px-2.5 py-1.5 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {hosts[m].name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {machines.map((m) => (
        <Column
          key={m}
          host={hosts[m]}
          active={false}
          onClick={() => onView(m)}
          hint={`Show only ${hosts[m].name}`}
        />
      ))}
    </div>
  );
}

function Column({
  host,
  active,
  onClick,
  hint,
}: {
  host: HostSummary;
  active: boolean;
  onClick: () => void;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={cn(
        "group focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left transition-colors",
        "hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      <StatusDot status={host.status} />
      <span className="truncate text-[13px] font-semibold">{host.name}</span>
      <span className="text-muted-foreground hidden truncate text-[11px] sm:inline">{host.role}</span>
      <span className="text-muted-foreground/0 group-hover:text-muted-foreground ml-auto hidden shrink-0 text-[10px] tracking-wide transition-colors sm:inline">
        {hint.toLowerCase()}
      </span>
    </button>
  );
}
