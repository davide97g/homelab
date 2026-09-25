import type { Tone } from "@wire";
import { ArrowUpRight, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { AtlasFocus, AtlasItem, AtlasLayer } from "@/components/atlas/model";
import { MiniBar, STATUS_LABEL, STATUS_TONE, StatusDot, TONE_TEXT } from "@/components/primitives";
import { cn } from "@/lib/utils";

const ADDRESS: Record<string, string> = {
  lan: "LAN",
  tailnet: "tailnet",
  public: "public",
  none: "",
};

export function AtlasHud({
  machines,
  services,
  containers,
  watts,
  layer,
  onLayer,
}: {
  machines: { up: number; total: number; tone: Tone };
  services: { up: number; total: number; tone: Tone } | null;
  containers: { running: number; total: number } | null;
  watts: string;
  layer: AtlasLayer;
  onLayer: (layer: AtlasLayer) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Stat
          label="Machines"
          value={`${machines.up}/${machines.total}`}
          tone={machines.tone}
          hint="answering"
        />
        <Stat
          label="Services"
          value={services ? `${services.up}/${services.total}` : "—"}
          tone={services?.tone}
          hint="media pipeline"
        />
        <Stat
          label="Containers"
          value={containers ? `${containers.running}` : "—"}
          hint={containers ? `${containers.total} seen` : "reading"}
        />
        <Stat label="Wall" value={watts} hint="at the plug" />
      </div>

      <div className="neu-inset flex w-fit flex-wrap gap-0.5 p-0.5" role="group" aria-label="What to show">
        {(
          [
            ["all", "All"],
            ["devices", "Devices"],
            ["services", "Services"],
            ["containers", "Containers"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={layer === id}
            onClick={() => onLayer(id)}
            className={cn(
              "h-11 rounded-[10px] px-3 text-[12px] font-medium sm:h-7",
              "focus-visible:ring-ring/60 transition-colors focus-visible:ring-2 focus-visible:outline-none",
              layer === id ? "bg-chip text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: Tone }) {
  return (
    <div className="neu min-w-0 px-3 py-2 sm:min-w-[7.25rem]">
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className={cn("tnum text-[17px] leading-tight font-semibold tracking-tight", tone && TONE_TEXT[tone])}>
        {value}
      </div>
      <div className="text-muted-foreground truncate text-[10px]">{hint}</div>
    </div>
  );
}

export function AtlasLedger({
  items,
  focus,
  query,
  onQuery,
  note,
  onFocus,
  onSelect,
  className,
}: {
  items: AtlasItem[];
  focus: AtlasFocus;
  query: string;
  onQuery: (query: string) => void;
  note: string | null;
  onFocus: (focus: AtlasFocus) => void;
  onSelect: (focus: Exclude<AtlasFocus, null>) => void;
  className?: string;
}) {
  const groups: { kind: AtlasItem["kind"]; label: string }[] = [
    { kind: "device", label: "Devices" },
    { kind: "service", label: "Services" },
    { kind: "container", label: "Containers" },
  ];

  return (
    <aside className={cn("flex min-h-0 flex-col gap-2", className)}>
      <input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Find a device, service or container"
        aria-label="Find a device, service or container"
        className="neu-inset placeholder:text-muted-foreground/70 h-11 w-full px-3 text-[13px] outline-none sm:h-9 focus-visible:ring-ring/60 focus-visible:ring-2"
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5 lg:max-h-[calc(100%-2.75rem)]">
        {items.length === 0 && (
          <p className="text-muted-foreground px-1 py-6 text-center text-[12px]">Nothing matches.</p>
        )}
        {groups.map((group) => {
          const rows = items.filter((item) => item.kind === group.kind);
          if (rows.length === 0) return null;
          return (
            <section key={group.kind} className="flex flex-col gap-0.5">
              <h2 className="text-muted-foreground px-1.5 pb-1 text-[10px] font-medium tracking-wide">
                {group.label}
                <span className="tnum ml-1.5">{rows.length}</span>
              </h2>
              {rows.map((item) => {
                const active = focus?.kind === item.kind && focus.id === item.id;
                return (
                  <button
                    key={`${item.kind}:${item.id}`}
                    id={`atlas-${item.kind}-${item.id}`}
                    type="button"
                    aria-pressed={active}
                    onMouseEnter={() => onFocus({ kind: item.kind, id: item.id })}
                    onFocus={() => onFocus({ kind: item.kind, id: item.id })}
                    onClick={() => onSelect({ kind: item.kind, id: item.id })}
                    className={cn(
                      "flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-left",
                      "focus-visible:ring-ring/60 transition-colors focus-visible:ring-2 focus-visible:outline-none",
                      active ? "bg-chip" : "hover:bg-muted/80",
                    )}
                  >
                    <StatusDot status={item.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{item.label}</span>
                      <span className="text-muted-foreground block truncate text-[10px]">
                        {item.stats[0] ? `${item.stats[0].label} ${item.stats[0].value}` : item.role}
                      </span>
                    </span>
                    {!item.placed && item.kind === "container" && (
                      <span className="text-muted-foreground shrink-0 text-[10px]">list</span>
                    )}
                  </button>
                );
              })}
            </section>
          );
        })}
        {note && <p className="text-muted-foreground px-1.5 pt-1 text-[11px] leading-snug">{note}</p>}
      </div>
    </aside>
  );
}

export function AtlasCard({ item, className }: { item: AtlasItem; className?: string }) {
  const word = item.statusText ?? (item.status === "unconfigured" ? "not monitored" : STATUS_LABEL[item.status]);
  return (
    <div className={cn("glass flex flex-col gap-3 p-3.5", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={item.status} />
            <span className="truncate text-sm font-semibold">{item.label}</span>
          </div>
          <p className={cn("mt-0.5 text-[11px]", TONE_TEXT[STATUS_TONE[item.status]])}>{word}</p>
          <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">{item.role}</p>
        </div>
        {item.href && (
          <Link
            to={item.href}
            aria-label={`Open ${item.label}`}
            className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        )}
      </div>

      {item.addresses.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.addresses.map((address) => (
            <span
              key={`${address.kind}:${address.value}`}
              className="neu-inset tnum flex items-center gap-1.5 px-2 py-1 font-mono text-[11px]"
            >
              {address.value}
              {ADDRESS[address.kind] && (
                <span className="text-muted-foreground font-sans text-[9.5px] tracking-wide uppercase">
                  {ADDRESS[address.kind]}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {item.alerts.length > 0 && (
        <div className="text-tone-bad flex items-start gap-2 text-[11px]">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span>{item.alerts.join(", ")}</span>
        </div>
      )}

      {item.note && <p className="text-muted-foreground text-[11px] leading-snug">{item.note}</p>}

      {item.stats.length > 0 && (
        <dl className="grid gap-1.5">
          {item.stats.slice(0, 6).map((stat) => (
            <div key={stat.label}>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground text-[11px]">{stat.label}</dt>
                <dd className={cn("tnum text-[12px] font-medium", stat.tone && TONE_TEXT[stat.tone])}>{stat.value}</dd>
              </div>
              {stat.fraction != null && <MiniBar value={stat.fraction} tone={stat.tone ?? "accent"} className="mt-1" />}
            </div>
          ))}
        </dl>
      )}

      {item.lines.length > 0 && (
        <ul className="text-muted-foreground grid gap-1 text-[11px] leading-snug">
          {item.lines.slice(0, 5).map((line) => (
            <li key={line} className="truncate">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
