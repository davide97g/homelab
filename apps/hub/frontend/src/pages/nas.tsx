import type { NasDetail } from "@wire";
import { ArrowUpRight, Info } from "lucide-react";
import { useCallback } from "react";
import { MetricCard } from "@/components/cards/metric-card";
import { SensorList } from "@/components/cards/sensor-list";
import { MachineHero } from "@/components/hero/machine-hero";
import { ArrayCard, BayStrip, FilesystemList } from "@/components/nas/storage";
import { ArcGauge, FieldLabel, StatusDot, STATUS_LABEL, TONE_TEXT } from "@/components/primitives";
import { MetricsPage } from "@/pages/metrics-page";
import { usePoll } from "@/hooks/use-poll";
import { fetchNas } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The NAS gets its own endpoint rather than riding on /api/summary: only this
 *  page needs bays, arrays and sensors, and this is the machine whose answers
 *  come over a relayed tailnet hop, so it is the one worth being able to fail on
 *  its own. */
export function NasPage() {
  const load = useCallback((signal: AbortSignal) => fetchNas(signal), []);
  const { data, error } = usePoll<NasDetail>(load, 5000);

  if (error && !data) {
    return <div className="neu text-tone-bad mx-auto mt-6 max-w-lg p-5 text-sm">Could not read the NAS: {error}</div>;
  }
  if (!data) {
    return <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">Loading…</div>;
  }

  const host = data.host;
  const pool = data.pool;
  const featured = ["cpu.total", "mem.percent", "temp.hottest", "fs.percent"]
    .map((id) => host.metrics.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined);

  return (
    <div className="space-y-5">
      <section className="hero-glow grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <MachineHero machine="nas" hotspots={host.hotspots} className="mx-auto" />

          <ArcGauge
            value={pool?.percent ?? null}
            max={100}
            label="pool used"
            caption={pool ? `${pool.availDisplay} free of ${pool.sizeDisplay}` : "pool not reporting"}
            tone={(pool?.percent ?? 0) >= 90 ? "bad" : (pool?.percent ?? 0) >= 80 ? "warn" : "accent"}
            sweep={270}
            size={196}
            className="mx-auto"
          >
            <span className="tnum text-[34px] leading-none font-semibold">
              {pool?.percent === null || pool?.percent === undefined ? "—" : pool.percent.toFixed(0)}
            </span>
            <span className="text-muted-foreground text-xs">percent</span>
          </ArcGauge>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          {featured.map((m) => (
            <MetricCard key={m.id} metric={m} />
          ))}
        </div>
      </section>

      <section className="neu flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
        <span className="flex items-center gap-2">
          <StatusDot status={host.status} />
          <span className="text-sm font-semibold">{data.nodename ?? host.name}</span>
          <span className={cn("text-[11px]", TONE_TEXT[host.status === "up" ? "good" : host.status === "warn" ? "warn" : "bad"])}>
            {STATUS_LABEL[host.status]}
          </span>
        </span>
        <Fact label="hardware" value={host.role} />
        <Fact label="kernel" value={data.kernel ?? "—"} />
        <Fact label="package power" value={data.packageW === null ? "—" : `${data.packageW.toFixed(1)} W`} />
        <div className="ml-auto flex gap-1">
          {([["Cinema", data.links.cinema], ["Immich", data.links.immich]] as const)
            .filter(([, href]) => Boolean(href))
            .map(([label, href]) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="hover:bg-muted flex items-center gap-1 rounded-[10px] px-2.5 py-1.5 text-[12px] transition-colors"
              >
                {label}
                <ArrowUpRight className="text-muted-foreground size-3.5" />
              </a>
            ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="neu space-y-3 p-4">
          <FieldLabel>Bays</FieldLabel>
          <BayStrip bays={data.bays} poolPercent={pool?.percent ?? null} />
        </div>

        <div className="space-y-4">
          {data.arrays.length === 0 ? (
            <div className="neu text-muted-foreground p-4 text-xs">No md arrays are being reported.</div>
          ) : (
            data.arrays.map((a) => <ArrayCard key={a.device} array={a} />)
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="neu space-y-3 p-4">
          <FieldLabel>Filesystems</FieldLabel>
          <FilesystemList filesystems={data.filesystems} />
        </div>

        <div className="neu space-y-3 p-4">
          <FieldLabel>Temperatures</FieldLabel>
          <SensorList sensors={data.sensors} />
        </div>

        <div className="neu space-y-3 p-4">
          <div className="flex items-center justify-between">
            <FieldLabel>Containers</FieldLabel>
            <span className="text-muted-foreground tnum text-[11px]">{data.containers.length} running</span>
          </div>
          {data.containers.length === 0 ? (
            <p className="text-muted-foreground text-xs">cAdvisor on the NAS is not reporting containers.</p>
          ) : (
            <div className="grid gap-1.5">
              {data.containers.map((c) => (
                <div key={c.name} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px]" title={c.name}>
                    {c.name}
                  </span>
                  <span className="text-muted-foreground tnum shrink-0 text-[11px]">
                    {c.cpuPercent.toFixed(1)}% · {c.rssDisplay}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <FieldLabel>Over time</FieldLabel>
        <MetricsPage
          machines={["nas"]}
          panels={[
            { id: "fs.used", wide: true },
            { id: "disk.io" },
            { id: "disk.util" },
            { id: "temp.sensors", wide: true, height: 240 },
            { id: "power.nas" },
            { id: "net.throughput" },
          ]}
        />
      </section>

      <section className="neu space-y-2 p-4">
        <div className="flex items-center gap-2">
          <Info className="text-muted-foreground size-4" />
          <FieldLabel>What this page cannot tell you</FieldLabel>
        </div>
        <ul className="text-muted-foreground space-y-1.5 text-[11.5px] leading-relaxed">
          {data.notes.map((note) => (
            <li key={note}>— {note}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <FieldLabel>{label}</FieldLabel>
      <span className="text-[12px]">{value}</span>
    </span>
  );
}
