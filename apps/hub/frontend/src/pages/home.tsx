import type { Summary } from "@wire";
import { ArrowUpRight, Zap } from "lucide-react";
import { AlertStrip } from "@/components/cards/alert-strip";
import { ContainerTile } from "@/components/cards/container-tile";
import { HostCard } from "@/components/cards/host-card";
import { MetricCard } from "@/components/cards/metric-card";
import { MachineHero } from "@/components/hero/machine-hero";
import { ArcGauge, CardHeading, FieldLabel, StatusDot } from "@/components/primitives";
import { useCompact, useShortViewport } from "@/hooks/use-media-query";

/** The mini PC is the hero and the NAS is a card, because that is the actual
 *  ratio of attention: one machine runs forty containers and the tunnel, the
 *  other holds photos and a Jellyfin. */
export function HomePage({ data }: { data: Summary }) {
  const compact = useCompact();
  const short = useShortViewport();
  const box = data.hosts.homelab;
  const nas = data.hosts.nas;
  const power = data.power;

  // Four for the glass row, the rest fall to the host card underneath. Ordered
  // by how often they answer a question, not by how they are collected.
  const featured = ["cpu.total", "temp.hottest", "mem.percent", "fs.percent"]
    .map((id) => box.metrics.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined);

  return (
    <div className="space-y-4">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* The machine, in a card of its own. Hero and featured numbers side by
            side from `sm` up; on a phone the four numbers come first and the
            picture under them, because the numbers are why the page was opened. */}
        <div className="neu hero-glow flex flex-col gap-4 overflow-hidden p-5 sm:p-6">
          <CardHeading
            title={
              <span className="flex items-center gap-2">
                <StatusDot status={box.status} />
                {box.name}
              </span>
            }
            subtitle={box.role}
          />
          <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,240px)]">
            <MachineHero
              machine="homelab"
              hotspots={box.hotspots}
              className="mx-auto max-w-[200px] sm:max-w-[420px] [@media(max-height:560px)]:max-w-[200px]"
            />
            <div className="order-first grid grid-cols-2 gap-x-4 gap-y-5 sm:order-none sm:grid-cols-1">
              {featured.map((m, i) => (
                <div key={m.id} className="rise-in" style={{ "--i": i } as React.CSSProperties}>
                  <MetricCard metric={m} surface="bare" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* The black island: the one number this box is judged on. */}
        <div className="ink relative flex flex-col overflow-hidden rounded-xl p-5 sm:p-6">
          <span className="chrome-orb absolute -top-8 -right-8 size-28 opacity-90" aria-hidden />
          <div className="relative flex items-center gap-2 text-sm font-medium">
            <Zap className="size-4" />
            Wall power
            {power.wallW !== null && power.wallW > 45 && (
              <span className="bg-tone-warn/20 text-tone-warn ml-auto rounded-full px-2 py-0.5 text-xs">high</span>
            )}
          </div>
          <ArcGauge
            value={power.wallW}
            max={60}
            label={power.source === "plug" ? "measured at the plug" : "modelled — plug unreachable"}
            tone={power.wallW !== null && power.wallW > 45 ? "warn" : "accent"}
            sweep={270}
            size={compact ? 168 : short ? 150 : 196}
            className="relative mx-auto my-auto py-4"
          >
            <span className="tnum text-[34px] leading-none font-medium tracking-tight sm:text-[40px]">
              {power.wallW === null ? "—" : `${power.wallW.toFixed(0)}`}
            </span>
            <span className="text-muted-foreground text-xs">watts</span>
          </ArcGauge>
          <div className="relative grid grid-cols-3 gap-3 border-t pt-4">
            <Stat label="Per day" value={power.kwhPerDay === null ? "—" : `${power.kwhPerDay.toFixed(2)} kWh`} />
            <Stat
              label="Per month"
              value={power.eurPerMonth === null ? "—" : `€${power.eurPerMonth.toFixed(2)}`}
              hint={`at €${power.costPerKwh.toFixed(2)}/kWh`}
            />
            <Stat
              label="APU"
              value={power.packageW === null ? "—" : `${power.packageW.toFixed(1)} W`}
              hint="CPU + iGPU rail"
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <ContainerTile containers={data.containers} />
        <HostCard host={nas} to="/nas" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <FieldLabel className="px-1">Alerts</FieldLabel>
          <AlertStrip alerts={data.alerts} />
        </div>

        <div className="space-y-2">
          <FieldLabel className="px-1">Elsewhere</FieldLabel>
          <div className="neu grid gap-1 p-2">
            {(
              [
                ["Grafana", data.links.grafana],
                ["Dokploy", data.links.dokploy],
                ["Jellyfin", data.links.jellyfin],
                ["Cinema (NAS)", data.links.cinema],
              ] as const
            )
              .filter(([, href]) => Boolean(href))
              .map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:bg-muted group/link flex h-11 items-center justify-between rounded-lg px-3 text-sm font-medium transition-colors"
                >
                  {label}
                  <ArrowUpRight className="text-muted-foreground size-4 transition-transform group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" />
                </a>
              ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground truncate text-xs">{label}</span>
      <span className="tnum truncate font-mono text-sm font-medium">{value}</span>
      {hint && <span className="text-muted-foreground/80 truncate text-[11px]">{hint}</span>}
    </div>
  );
}
