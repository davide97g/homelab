import type { ActionDef, ContainerDetail, ContainersResponse } from "@wire";
import { Info, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionButton } from "@/components/actions/action-button";
import { MiniBar, Segmented, TONE_BG, TONE_TEXT } from "@/components/primitives";
import { Input } from "@/components/ui/input";
import { usePoll } from "@/hooks/use-poll";
import { fetchActions, fetchContainers } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATE_TONE = {
  running: "good",
  restarting: "warn",
  paused: "warn",
  created: "default",
  exited: "bad",
  dead: "bad",
  removing: "warn",
  unknown: "default",
} as const;

type Scope = "all" | "homelab" | "nas" | "problems";

/** Every container on both machines.
 *
 *  The list is Docker's and the numbers are cAdvisor's, because each knows
 *  something the other cannot. Docker knows about containers that are *not*
 *  running — normally the one you opened this page for — along with exit codes,
 *  health and restart counts. cAdvisor knows what a container is doing, and
 *  covers the NAS, which has no socket here to proxy. */
export function ContainersPage() {
  const load = useCallback((signal: AbortSignal) => fetchContainers(signal), []);
  const { data, error, refresh } = usePoll<ContainersResponse>(load, 5000);
  const [scope, setScope] = useState<Scope>("all");
  const [search, setSearch] = useState("");

  // The action buttons live here rather than on /actions, next to the container
  // they act on: a list of container names on a separate page is a way to
  // restart the wrong one. Their definitions still come from the server, so
  // nothing about risk or confirmation is duplicated in the browser.
  const [actions, setActions] = useState<Record<string, ActionDef>>({});
  useEffect(() => {
    const controller = new AbortController();
    fetchActions(controller.signal)
      .then((c) =>
        setActions(Object.fromEntries(c.actions.filter((a) => a.target === "container").map((a) => [a.id, a]))),
      )
      .catch(() => setActions({}));
    return () => controller.abort();
  }, []);

  const rows = useMemo(() => {
    const all = data?.containers ?? [];
    const needle = search.trim().toLowerCase();
    return all.filter((c) => {
      if (scope === "homelab" || scope === "nas") return c.instance === scope && matches(c, needle);
      if (scope === "problems") return (c.state !== "running" || c.health === "unhealthy") && matches(c, needle);
      return matches(c, needle);
    });
  }, [data, scope, search]);

  if (error && !data) {
    return <div className="neu text-tone-bad mx-auto mt-6 max-w-lg p-5 text-sm">Could not list containers: {error}</div>;
  }
  if (!data) {
    return <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">Loading…</div>;
  }

  const peak = Math.max(1, ...rows.map((c) => c.cpuPercent ?? 0));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented
          options={[
            { value: "all" as Scope, label: "all" },
            { value: "homelab" as Scope, label: "homelab" },
            { value: "nas" as Scope, label: "nas" },
            { value: "problems" as Scope, label: "not running" },
          ]}
          value={scope}
          onChange={setScope}
          label="Scope"
        />

        {/* Full width on a phone, where a 16rem box would wrap to its own line
            anyway and leave two thirds of it empty. 16px of text on purpose:
            anything smaller and iOS zooms the whole page on focus. */}
        <div className="relative w-full sm:w-auto">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="name, image or compose project"
            className="h-11 w-full pl-8 text-[16px] sm:h-8 sm:w-64 sm:text-[12px]"
          />
        </div>

        <span className="text-muted-foreground tnum text-[11px]">
          {data.counts.running} running · {data.counts.stopped} stopped · {data.counts.total} total
        </span>
      </div>

      {data.notice && (
        <div className="neu text-muted-foreground flex items-start gap-2 p-3 text-[11.5px] leading-relaxed">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>{data.notice}</span>
        </div>
      )}

      <div className="neu divide-border divide-y p-1">
        {rows.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">Nothing matches.</p>
        ) : (
          rows.map((c) => (
            <Row key={`${c.instance}:${c.id}`} container={c} peak={peak} actions={actions} onDone={refresh} />
          ))
        )}
      </div>
    </div>
  );
}

function matches(c: ContainerDetail, needle: string): boolean {
  if (!needle) return true;
  return (
    c.name.toLowerCase().includes(needle) ||
    c.image.toLowerCase().includes(needle) ||
    (c.compose?.project ?? "").toLowerCase().includes(needle)
  );
}

function Row({
  container: c,
  peak,
  actions,
  onDone,
}: {
  container: ContainerDetail;
  peak: number;
  actions: Record<string, ActionDef>;
  onDone: () => void;
}) {
  const tone = STATE_TONE[c.state];
  // A stopped container can only be started, a running one stopped or
  // restarted. Offering the other half would be a button that exists to return
  // an error.
  const offered = (c.state === "running" ? ["container.restart", "container.stop"] : ["container.start"])
    .map((id) => actions[id])
    .filter((a): a is ActionDef => Boolean(a) && a!.available);

  return (
    // Three columns is the right shape for this row and the wrong shape for a
    // phone: the third one is a fixed ~270px of gauge and buttons, which on a
    // 390px screen left the name column about two characters wide. Below `sm`
    // the same four facts stack instead -- what it is, how it is, what it costs,
    // what you can do about it -- and the grid comes back from `sm` up.
    <div className="flex flex-col gap-2 px-3 py-3 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_auto] sm:items-center sm:gap-3 sm:py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", TONE_BG[tone])} aria-hidden />
          <span className="truncate text-[13px] font-medium" title={c.name}>
            {c.name}
          </span>
          {c.health === "unhealthy" && <span className="text-tone-bad text-[10px] font-medium">unhealthy</span>}
          {c.restarts !== null && c.restarts > 0 && (
            <span className="text-muted-foreground text-[10px]">{c.restarts} restarts</span>
          )}
        </div>
        <p className="text-muted-foreground truncate text-[11px]" title={c.image}>
          {c.image}
          {c.compose ? ` · ${c.compose.project}/${c.compose.service}` : ""}
        </p>
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={cn("truncate text-[11.5px]", TONE_TEXT[tone])} title={c.status}>
            {c.status}
          </span>
        </div>
        {c.ports.length > 0 && (
          <p className="text-muted-foreground tnum truncate text-[10.5px]">{c.ports.join(" · ")}</p>
        )}
      </div>

      <div className="flex items-center gap-3 sm:shrink-0">
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:w-32 sm:flex-none sm:items-end">
          <span className="text-muted-foreground tnum text-[11px]">
            {c.cpuPercent === null ? "—" : `${c.cpuPercent.toFixed(1)}%`} · {c.rssDisplay}
          </span>
          <MiniBar value={(c.cpuPercent ?? 0) / peak} tone="accent" className="w-full sm:w-24" />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 sm:min-w-[9rem]">
          {c.managed ? (
            offered.map((a) => (
              <ActionButton
                key={a.id}
                action={a.id}
                target={c.name}
                label={a.id.split(".")[1] ?? a.label}
                confirm={a.confirm}
                title={a.description}
                variant="ghost"
                // A restart button you have to aim at is how the wrong container
                // gets restarted.
                buttonClassName="h-11 px-3.5 sm:h-8 sm:px-3"
                onDone={onDone}
              />
            ))
          ) : (
            <span className="text-muted-foreground max-w-[9rem] truncate text-[10.5px]" title={c.reason}>
              {c.reason ? "read-only" : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
