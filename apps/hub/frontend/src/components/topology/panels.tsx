import type { Status, TopoLink, TopoNode, Topology, Transport } from "@wire";
import { ArrowUpRight, MoveRight, TriangleAlert } from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router-dom";
import {
  FieldLabel,
  MetricRows,
  StatusDot,
  STATUS_LABEL,
  STATUS_TONE,
  TONE_BG,
  TONE_TEXT,
} from "@/components/primitives";
import { cn } from "@/lib/utils";

// The parts of the page that are not the picture: the ledger down the left, the
// card that explains whatever is under the pointer, and the legend.
//
// All three are shared by the WebGL scene and the flat SVG, which is what makes
// it safe to say a phone sees the same estate as a desktop and not a summary of
// it.

export type Focus = { kind: "node" | "link"; id: string } | null;

/** A link's `unconfigured` does not mean "not set up". It means nothing in this
 *  stack measures that path, which is a different sentence and the one the page
 *  exists to be honest about. */
const LINK_STATUS_LABEL: Record<Status, string> = {
  up: "carrying",
  warn: "unverified",
  down: "down",
  unconfigured: "not measured",
};

/** Named after the thing that actually carries the bytes, not after the layer.
 *  "tailnet" and "internet + tunnel" were accurate and told you nothing: the two
 *  products doing the work here are Tailscale and Cloudflare, and every one of
 *  this estate's interesting failures is one of them having a bad day. */
const TRANSPORT_LABEL: Record<Transport, string> = {
  lan: "LAN",
  tailnet: "Tailscale tailnet",
  internet: "public internet",
  tunnel: "outbound tunnel",
  wifi: "Wi-Fi",
};

/** Colour is never the only carrier here — a status dot is always next to a word
 *  — but the swatch is what ties a row to the line in the picture. */
export const TRANSPORT_STROKE: Record<Transport, string> = {
  lan: "text-chart-8",
  tailnet: "text-chart-2",
  internet: "text-chart-4",
  tunnel: "text-chart-4",
  wifi: "text-chart-6",
};

export const TRANSPORT_SWATCH: Record<Transport, string> = {
  lan: "bg-chart-8",
  tailnet: "bg-chart-2",
  internet: "bg-chart-4",
  tunnel: "bg-chart-4",
  wifi: "bg-chart-6",
};

function addressLabel(kind: TopoNode["addresses"][number]["kind"]): string {
  return kind === "lan" ? "LAN" : kind === "tailnet" ? "tailnet" : kind === "public" ? "public" : "";
}

// ——— The ledger ——————————————————————————————————————————————————————————————

/** Every node as a row, grouped by flat.
 *
 *  Not chrome. A node-link picture is close to unreadable without sight or a
 *  pointer, so this is the alternative representation that makes the page usable
 *  at all: the same nodes, the same statuses, in a list you can walk with the
 *  arrow keys and open with Enter. It is also the fastest way to find a machine
 *  when you already know its name, which on a six-node estate is always. */
export function Ledger({
  topology,
  focus,
  onFocus,
  onSelect,
  className,
}: {
  topology: Topology;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  onSelect: (focus: Exclude<Focus, null>) => void;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);

  // Roving focus with the arrow keys, over whatever rows are actually rendered.
  // Querying the DOM rather than tracking an index keeps this correct when a
  // site has no nodes or the payload changes shape under it.
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-topo-row]") ?? []);
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = rows[at + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  return (
    <div ref={list} onKeyDown={onKeyDown} className={cn("neu flex flex-col gap-4 p-3", className)} aria-label="Devices">
      {topology.sites.map((site) => {
        const nodes = topology.nodes.filter((n) => n.site === site.id);
        if (nodes.length === 0) return null;

        return (
          <div key={site.id} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2 px-1.5">
              <FieldLabel>{site.label}</FieldLabel>
              {site.subnet && <span className="text-muted-foreground tnum font-mono text-[10px]">{site.subnet}</span>}
            </div>

            {nodes.map((node) => {
              const active = focus?.kind === "node" && focus.id === node.id;
              const headline = node.metrics.find((m) => m.value !== null);

              return (
                <button
                  key={node.id}
                  type="button"
                  data-topo-row
                  aria-pressed={active}
                  onMouseEnter={() => onFocus({ kind: "node", id: node.id })}
                  onFocus={() => onFocus({ kind: "node", id: node.id })}
                  onClick={() => onSelect({ kind: "node", id: node.id })}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 text-left",
                    "focus-visible:ring-ring/60 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    active ? "bg-chip" : "hover:bg-chip/60",
                  )}
                >
                  <StatusDot status={node.status} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{node.label}</span>
                  <span className={cn("shrink-0 text-[10px]", TONE_TEXT[STATUS_TONE[node.status]])}>
                    {node.status === "unconfigured" ? "not watched" : STATUS_LABEL[node.status]}
                  </span>
                  {node.alerts.length > 0 && (
                    <TriangleAlert
                      className="text-tone-bad size-3.5 shrink-0"
                      aria-label={`${node.alerts.length} alert${node.alerts.length === 1 ? "" : "s"} firing`}
                    />
                  )}
                  {headline && (
                    <span className="text-muted-foreground tnum hidden shrink-0 text-[11px] xl:inline">
                      {headline.display}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ——— The card ————————————————————————————————————————————————————————————————

function NodeDetail({ node }: { node: TopoNode }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={node.status} />
            <span className="text-sm font-semibold">{node.label}</span>
            <span className={cn("text-[11px]", TONE_TEXT[STATUS_TONE[node.status]])}>
              {node.status === "unconfigured" ? "not monitored" : STATUS_LABEL[node.status]}
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">{node.role}</p>
        </div>
        {node.href && (
          <Link
            to={node.href}
            aria-label={`Open ${node.label}`}
            className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        )}
      </div>

      {node.addresses.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {node.addresses.map((a) => (
            <span key={a.value} className="neu-inset tnum flex items-center gap-1.5 px-2 py-1 font-mono text-[11px]">
              {a.value}
              {a.kind !== "none" && (
                <span className="text-muted-foreground font-sans text-[9.5px] tracking-wide uppercase">
                  {addressLabel(a.kind)}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {node.alerts.length > 0 && (
        <div className="text-tone-bad flex items-start gap-2 text-[11px]">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span>{node.alerts.join(", ")}</span>
        </div>
      )}

      {node.note && <p className="text-muted-foreground text-[11px] leading-snug">{node.note}</p>}

      {node.metrics.length > 0 && <MetricRows metrics={node.metrics} limit={5} />}
    </>
  );
}

function LinkDetail({ link, from, to }: { link: TopoLink; from?: TopoNode; to?: TopoNode }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", TRANSPORT_SWATCH[link.transport])} aria-hidden />
        <span className="text-sm font-semibold">
          {from?.label ?? link.from} → {to?.label ?? link.to}
        </span>
        <span className={cn("text-[11px]", TONE_TEXT[STATUS_TONE[link.status]])}>{LINK_STATUS_LABEL[link.status]}</span>
      </div>

      <div className="grid gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <FieldLabel>{link.carries}</FieldLabel>
          <span className="text-muted-foreground text-[11px]">{TRANSPORT_LABEL[link.transport]}</span>
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <FieldLabel>Rate</FieldLabel>
          {/* The one thing this page must never fudge: no measurement is not a
              zero, and it does not get a number. */}
          <span className={cn("tnum text-[13px] font-medium", !link.rate && "text-muted-foreground")}>
            {link.rate ? link.rate.display : "not measured"}
          </span>
        </div>

        {link.cadenceS !== undefined && (
          <div className="flex items-baseline justify-between gap-2">
            <FieldLabel>Every</FieldLabel>
            <span className="tnum text-[13px] font-medium">{link.cadenceS} s</span>
          </div>
        )}

        {link.latencyMs !== null && link.latencyMs !== undefined && (
          <div className="grid gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <FieldLabel>Round trip</FieldLabel>
              <span className="tnum text-[13px] font-medium">{link.latencyMs} ms</span>
            </div>
            <p className="text-muted-foreground text-[10.5px] leading-tight">
              How long the scrape took, not a ping — nothing in this stack probes with ICMP.
            </p>
          </div>
        )}
      </div>

      <p className="text-muted-foreground text-[11px] leading-snug">{link.note}</p>
    </>
  );
}

export function DetailCard({
  topology,
  focus,
  selected = false,
  className,
}: {
  topology: Topology;
  focus: Focus;
  selected?: boolean;
  className?: string;
}) {
  const node = focus?.kind === "node" ? topology.nodes.find((n) => n.id === focus.id) : undefined;
  const link = focus?.kind === "link" ? topology.links.find((l) => l.id === focus.id) : undefined;

  if (!node && !link) return null;

  return (
    <div className={cn("glass flex w-full flex-col gap-3 p-4 sm:w-[16.5rem]", className)}>
      {selected && <span className="text-muted-foreground self-end text-[10px] tracking-wide uppercase">Pinned · Esc clears</span>}
      {node ? (
        <NodeDetail node={node} />
      ) : link ? (
        <LinkDetail
          link={link}
          from={topology.nodes.find((n) => n.id === link.from)}
          to={topology.nodes.find((n) => n.id === link.to)}
        />
      ) : null}
    </div>
  );
}

// ——— The legend ——————————————————————————————————————————————————————————————

/** Two rows, always on screen: what the motion means, and what the colours are.
 *
 *  The picture animates in three different ways and the differences carry all of
 *  its meaning, so leaving them to be inferred would make it a puzzle. The second
 *  row is there because the two overlays that hold this estate together are
 *  products with names — a reader who does not know that the cyan path *is*
 *  Tailscale and the violet one *is* Cloudflare cannot tell which vendor's
 *  status page to open when a path goes quiet. */
export function Legend({ className }: { className?: string }) {
  return (
    <div className={cn("text-muted-foreground grid gap-1.5 text-[11px]", className)}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", TONE_BG.accent)} aria-hidden />
          one pulse per scrape — pulled
        </span>
        <span className="flex items-center gap-2">
          <span className="bg-chart-4 h-[3px] w-5 rounded-full" aria-hidden />a steady flow — pushed, scaled to the real
          rate
        </span>
        <span className="flex items-center gap-2">
          <span className="border-muted-foreground/60 h-0 w-5 border-t border-dashed" aria-hidden />
          still — nothing measures this path
        </span>
        <span className="flex items-center gap-2">
          <MoveRight className="size-3.5" aria-hidden />
          the arrow points the way the connection is dialled
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="flex items-center gap-2">
          <span className={cn("h-[3px] w-5 rounded-full", TRANSPORT_SWATCH.tailnet)} aria-hidden />
          Tailscale — the only route to the NAS, inbound only
        </span>
        <span className="flex items-center gap-2">
          <span className={cn("h-[3px] w-5 rounded-full", TRANSPORT_SWATCH.tunnel)} aria-hidden />
          Tunnels — Cloudflare publishes both hostnames, ProtonVPN carries torrents; no port is open anywhere
        </span>
        <span className="flex items-center gap-2">
          <span className={cn("h-[3px] w-5 rounded-full", TRANSPORT_SWATCH.lan)} aria-hidden />
          LAN
        </span>
        <span className="flex items-center gap-2">
          <span className={cn("h-[3px] w-5 rounded-full", TRANSPORT_SWATCH.wifi)} aria-hidden />
          Wi-Fi
        </span>
      </div>
    </div>
  );
}

/** What a node's status is called out loud. `unconfigured` is the wire's word
 *  for "nothing scrapes this", and reading that to someone is no help at all. */
export function nodeStatusLabel(status: Status): string {
  return status === "unconfigured" ? "not monitored" : STATUS_LABEL[status];
}
