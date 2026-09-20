import type { Health, StorageHost, StorageMount, StorageSummary, Tone } from "@wire";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { ArcGauge, FieldLabel, TONE_BG, TONE_TEXT } from "@/components/primitives";
import { sinceLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

// The occupancy recap: how much room there is, before any chart about how the
// fill moved.
//
// Everything here is drawn to one absolute scale — the largest filesystem in the
// estate is the full width, and every other bar is a real fraction of it. Two
// bars each normalised to their own 100% would say the mini PC's root and the
// NAS's pool are comparable objects, and they are 500 GB and 8 TB. The percent
// is still printed, because that is the number an alert fires on; the width is
// what makes "the NAS is the estate" obvious without reading anything.

/** A filesystem's tone. Not the shared HEALTH_TONE map, which paints "ok"
 *  green: green is the colour of a thing that is *done*, and a disk being 12%
 *  full is not an achievement. Blue until it is worth looking at. */
const FILL_TONE: Record<Health, Tone> = { ok: "accent", warn: "warn", bad: "bad", unknown: "default" };

/** One machine's colour, kept stable across the estate bar, the dials and the
 *  mount bars, so the same thing is the same colour everywhere on the page. */
const HOST_BG: Record<string, string> = { homelab: "bg-chart-1", nas: "bg-chart-2" };
const HOST_TEXT: Record<string, string> = { homelab: "text-chart-1", nas: "text-chart-2" };

export function StorageRecap({ data }: { data: StorageSummary }) {
  // The scale both machines' bars are drawn against. The whole estate, so a bar
  // is a share of everything there is.
  const scale = Math.max(...data.hosts.map((h) => h.sizeBytes ?? 0), 1);

  return (
    <div className="space-y-4">
      <EstateBar data={data} />
      <div className="grid gap-4 xl:grid-cols-2">
        {data.hosts.map((host) => (
          <HostCard key={host.instance} host={host} scale={scale} />
        ))}
      </div>
    </div>
  );
}

/** Everything the estate has, in one bar: each machine's used space, then what
 *  is left. The one picture that answers "is there room" for the whole house. */
function EstateBar({ data }: { data: StorageSummary }) {
  const size = data.estate.sizeBytes ?? 0;
  const share = (n: number | null) => (size > 0 ? Math.max(0, ((n ?? 0) / size) * 100) : 0);
  // The total only counts machines answering now, so it has to say which those
  // are rather than claim the estate when half of it is missing.
  const counted = data.hosts.filter((h) => h.reporting);
  const scope =
    counted.length === data.hosts.length ? "across both machines" : `on ${counted.map((h) => h.name).join(", ")}`;

  return (
    <div className="neu space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="flex items-baseline gap-2">
          <FieldLabel>Occupied</FieldLabel>
          <span className="tnum text-[22px] leading-none font-semibold">{data.estate.usedDisplay}</span>
          <span className="text-muted-foreground text-[12px]">of {data.estate.sizeDisplay}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="tnum text-tone-good text-[15px] font-semibold">{data.estate.availDisplay}</span>
          <span className="text-muted-foreground text-[12px]">free {counted.length === 0 ? "— nothing reporting" : scope}</span>
        </div>
      </div>

      <div className="neu-inset flex h-3.5 w-full overflow-hidden rounded-full">
        {counted.map((host) => (
          <div
            key={host.instance}
            className={cn("h-full transition-[width] duration-700", HOST_BG[host.instance])}
            style={{ width: `${share(host.usedBytes)}%` }}
            title={`${host.name}: ${host.usedDisplay} used`}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {data.hosts.map((host) => (
          <span key={host.instance} className="flex items-center gap-1.5 text-[11px]">
            <span className={cn("size-2 rounded-[3px]", host.reporting ? HOST_BG[host.instance] : "bg-muted")} />
            <span className="font-medium">{host.name}</span>
            <span className="text-muted-foreground tnum">
              {host.reporting
                ? `${host.usedDisplay} used`
                : host.asOf
                  ? `not counted · last sample ${sinceLabel(host.asOf)} ago`
                  : "not reporting"}
            </span>
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px]">
          <span className="border-border size-2 rounded-[3px] border" />
          <span className="text-muted-foreground">free</span>
        </span>
      </div>
    </div>
  );
}

function HostCard({ host, scale }: { host: StorageHost; scale: number }) {
  const tone: Tone = FILL_TONE[host.health];

  // Dimmed rather than hidden when the numbers are the last known ones: still
  // readable, visibly not live, and the badge above says how old they are.
  return (
    <div className={cn("neu space-y-4 p-4", !host.reporting && "opacity-75")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("size-2 rounded-[3px]", host.reporting ? HOST_BG[host.instance] : "bg-muted")} />
            <span className="text-[13px] font-semibold">{host.name}</span>
            {!host.reporting && host.asOf && (
              <span className="text-tone-warn text-[10px]" title={new Date(host.asOf).toLocaleString()}>
                as of {sinceLabel(host.asOf)} ago
              </span>
            )}
          </div>
          <p className="text-muted-foreground truncate text-[11px]">{host.role}</p>
        </div>
        <TrendChip host={host} />
      </div>

      {host.mounts.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-[12px] border border-dashed px-3 py-6 text-center text-[12px]">
          Prometheus has no filesystem sample for this machine within the last day. Missing, not empty.
        </p>
      ) : (
        <div className="flex items-center gap-4">
          <ArcGauge
            value={host.percent}
            max={100}
            label="used"
            tone={tone}
            sweep={270}
            size={124}
            className="shrink-0"
          >
            <span className="tnum text-[22px] leading-none font-semibold">
              {host.percent === null ? "—" : host.percent.toFixed(0)}
            </span>
            <span className="text-muted-foreground text-[10px]">percent</span>
          </ArcGauge>

          <div className="grid min-w-0 flex-1 gap-2.5">
            <Figure label="free" value={host.availDisplay} className={TONE_TEXT[tone]} />
            <Figure label="used" value={host.usedDisplay} />
            <Figure label="capacity" value={host.sizeDisplay} />
          </div>
        </div>
      )}

      {host.mounts.length > 0 && (
        <div className="grid gap-2.5 border-t border-border pt-3">
          {host.mounts.map((mount) => (
            <MountBar key={mount.mountpoint} mount={mount} scale={scale} />
          ))}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <FieldLabel>{label}</FieldLabel>
      <span className={cn("tnum text-[14px] font-semibold", className)}>{value}</span>
    </div>
  );
}

/** One filesystem. The bar's *length* is its size against the biggest filesystem
 *  in the estate, and the filled part of it is what is used — so a nearly-full
 *  boot partition stays visibly tiny next to a half-empty pool, which is the
 *  honest reading of the two. */
function MountBar({ mount, scale }: { mount: StorageMount; scale: number }) {
  const tone: Tone = FILL_TONE[mount.health];
  const size = mount.sizeBytes ?? 0;
  // A floor of 1.5%, because a 500 MB partition next to 8 TB rounds to nothing
  // and a row with no bar at all reads as a failure to draw one.
  const width = scale > 0 ? Math.max(1.5, (size / scale) * 100) : 0;
  const fill = size > 0 && mount.usedBytes !== null ? Math.min(100, (mount.usedBytes / size) * 100) : 0;

  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[12px] font-medium" title={`${mount.device} · ${mount.fstype}`}>
            {mount.mountpoint}
          </span>
          {mount.headline && <span className={cn("text-[9.5px] uppercase", HOST_TEXT[mount.instance])}>main</span>}
          {mount.aliases.length > 0 && (
            <span className="text-muted-foreground truncate text-[10.5px]" title={mount.aliases.join(", ")}>
              also {mount.aliases.join(", ")}
            </span>
          )}
        </span>
        <span className="text-muted-foreground tnum shrink-0 text-[11px]">
          {mount.usedDisplay} / {mount.sizeDisplay} · {mount.percent === null ? "—" : `${mount.percent.toFixed(0)}%`}
        </span>
      </div>

      {/* Two nested tracks: the outer one is the estate, the inner one is this
          filesystem's share of it, and the fill inside that is what is on it. */}
      <div className="h-2 w-full">
        <div
          className="neu-inset h-2 overflow-hidden rounded-full transition-[width] duration-700"
          style={{ width: `${width}%` }}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-700", TONE_BG[tone])}
            style={{ width: `${fill}%` }}
          />
        </div>
      </div>

      {mount.trend.bytesPerDay !== null && mount.trend.daysToFull !== null && (
        <span className="text-muted-foreground text-[10.5px]">
          {mount.trend.display} · {mount.trend.fullDisplay}
        </span>
      )}
    </div>
  );
}

/** Where the machine is heading, in one chip. Filling, freeing or steady —
 *  and, when it is filling fast enough to matter, when it runs out. */
function TrendChip({ host }: { host: StorageHost }) {
  const perDay = host.trend.bytesPerDay;
  const filling = perDay !== null && host.trend.daysToFull !== null;
  const freeing = perDay !== null && perDay < 0 && host.trend.display !== "steady";
  const Icon = filling ? ArrowUpRight : freeing ? ArrowDownRight : Minus;
  const tone: Tone = filling && (host.trend.daysToFull ?? Infinity) < 60 ? "warn" : freeing ? "good" : "default";

  return (
    <span className="neu-inset flex shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 py-1.5">
      <Icon className={cn("size-3.5", TONE_TEXT[tone])} />
      <span className="tnum text-[11px] font-medium">{host.trend.display}</span>
      <span className="text-muted-foreground text-[11px]">{host.trend.fullDisplay}</span>
    </span>
  );
}
