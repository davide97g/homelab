import type { Summary } from "@wire";
import { ArrowUpRight } from "lucide-react";
import { AlertStrip } from "@/components/cards/alert-strip";
import { ContainerTile } from "@/components/cards/container-tile";
import { HostCard } from "@/components/cards/host-card";
import { MetricCard } from "@/components/cards/metric-card";
import { MachineHero } from "@/components/hero/machine-hero";
import { ArcGauge, FieldLabel } from "@/components/primitives";
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
    <div className="space-y-5">
      <section className="hero-glow grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Side by side from the first pixel rather than stacked below `sm`. The
            hero and the dial stacked are ~520px of picture, which on a phone is
            the entire first screen and pushes every number below the fold --
            and the numbers are why the page was opened. Shoulder to shoulder
            they are ~190px and the four headline metrics land above it. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:gap-5">
          <MachineHero machine="homelab" hotspots={box.hotspots} className="mx-auto max-w-[150px] sm:max-w-[420px] [@media(max-height:560px)]:max-w-[200px]" />

          <ArcGauge
            value={power.wallW}
            max={60}
            label="wall power"
            caption={power.source === "plug" ? "measured at the plug" : "modelled — plug unreachable"}
            tone={power.wallW !== null && power.wallW > 45 ? "warn" : "accent"}
            sweep={270}
            size={compact ? 156 : short ? 150 : 196}
            className="mx-auto"
          >
            <span className="tnum text-[28px] leading-none font-semibold sm:text-[34px]">
              {power.wallW === null ? "—" : `${power.wallW.toFixed(0)}`}
            </span>
            <span className="text-muted-foreground text-xs">watts</span>
          </ArcGauge>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          {featured.map((m) => (
            <MetricCard key={m.id} metric={m} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="neu flex flex-col justify-between gap-3 p-4">
          <FieldLabel>Energy</FieldLabel>
          <div className="grid gap-2">
            <Figure label="per day" value={power.kwhPerDay === null ? "—" : `${power.kwhPerDay.toFixed(2)} kWh`} />
            <Figure
              label="per month"
              value={power.eurPerMonth === null ? "—" : `€${power.eurPerMonth.toFixed(2)}`}
              hint={`at €${power.costPerKwh.toFixed(2)}/kWh`}
            />
            <Figure
              label="APU package"
              value={power.packageW === null ? "—" : `${power.packageW.toFixed(1)} W`}
              hint="CPU and iGPU rail, averaged"
            />
          </div>
        </div>

        <ContainerTile containers={data.containers} />
        <HostCard host={nas} to="/nas" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <FieldLabel>Alerts</FieldLabel>
          <AlertStrip alerts={data.alerts} />
        </div>

        <div className="space-y-2">
          <FieldLabel>Elsewhere</FieldLabel>
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
                  className="hover:bg-muted flex items-center justify-between rounded-[10px] px-3 py-2 text-sm transition-colors"
                >
                  {label}
                  <ArrowUpRight className="text-muted-foreground size-3.5" />
                </a>
              ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[12px]">{label}</div>
        {hint && <div className="text-muted-foreground text-[10px]">{hint}</div>}
      </div>
      <span className="tnum shrink-0 text-[15px] font-semibold">{value}</span>
    </div>
  );
}
