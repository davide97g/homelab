import type { ContainerDetail, ContainersResponse } from "@wire";
import { Info, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { MiniBar, Segmented, TONE_BG, TONE_TEXT } from "@/components/primitives";
import { Input } from "@/components/ui/input";
import { usePoll } from "@/hooks/use-poll";
import { fetchContainers } from "@/lib/api";
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
  const { data, error } = usePoll<ContainersResponse>(load, 5000);
  const [scope, setScope] = useState<Scope>("all");
  const [search, setSearch] = useState("");

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
      <div className="flex flex-wrap items-center gap-3">
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

        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="name, image or compose project"
            className="h-8 w-64 pl-8 text-[12px]"
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
          rows.map((c) => <Row key={`${c.instance}:${c.id}`} container={c} peak={peak} />)
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

function Row({ container: c, peak }: { container: ContainerDetail; peak: number }) {
  const tone = STATE_TONE[c.state];

  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_auto] items-center gap-3 px-3 py-2.5">
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

      <div className="flex w-40 shrink-0 flex-col items-end gap-1">
        <span className="text-muted-foreground tnum text-[11px]">
          {c.cpuPercent === null ? "—" : `${c.cpuPercent.toFixed(1)}%`} · {c.rssDisplay}
        </span>
        <MiniBar value={(c.cpuPercent ?? 0) / peak} tone="accent" className="w-24" />
      </div>
    </div>
  );
}
