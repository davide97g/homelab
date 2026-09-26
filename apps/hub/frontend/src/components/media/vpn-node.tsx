import type { MediaNode, VpnSnapshot } from "@wire";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ArrowUpRight, Check, Cpu, Globe2, MemoryStick, Minus, Shield, X } from "lucide-react";
import { memo } from "react";
import { KillSwitch } from "@/components/media/kill-switch";
import { FieldLabel, STATUS_LABEL, StatusDot } from "@/components/primitives";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type VpnNodeData = {
  node: MediaNode;
  vpn: VpnSnapshot | null;
  selected: boolean;
  onSelect: (id: string) => void;
  onChanged: () => void;
};

export type VpnFlowNode = Node<VpnNodeData, "vpn">;

/** A yes / no / not-known mark. Three states on purpose: a check that could not
 *  be made must not look like one that passed. */
function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <Minus className="text-muted-foreground size-3.5 shrink-0" />;
  return ok ? (
    <Check className="text-tone-good size-3.5 shrink-0" />
  ) : (
    <X className="text-tone-bad size-3.5 shrink-0" />
  );
}

function Row({ label, value, ok, title }: { label: string; value: string; ok: boolean | null; title?: string }) {
  return (
    <div className="flex items-center justify-between gap-2" title={title}>
      <FieldLabel>{label}</FieldLabel>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="tnum truncate font-mono text-[11.5px]">{value}</span>
        {/* A dash for a value already says "not known"; a second one is noise. */}
        {value !== "—" && <Mark ok={ok} />}
      </span>
    </div>
  );
}

function since(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The tunnel qBittorrent lives inside.
 *
 *  Not a ServiceNode: that card renders a generic stat list, and this one has to
 *  answer three specific questions at a glance — where do peers think the box
 *  is, can they reach it, and is anything leaking — then carry the one control
 *  on this page that changes what the box is doing. The generic stats for the
 *  same node still exist; the drawer shows them. */
function VpnNodeImpl({ data }: NodeProps<VpnFlowNode>) {
  const { node, vpn, selected, onSelect, onChanged } = data;
  const engaged = vpn?.killSwitch ?? false;
  const t = vpn?.torrent ?? null;
  const where = vpn?.exit ? [vpn.exit.city, vpn.exit.country].filter(Boolean).join(", ") : null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(node.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
      className={cn(
        "neu w-[300px] cursor-pointer overflow-hidden text-left transition-[transform,box-shadow] duration-200 motion-reduce:transition-none",
        "hover:-translate-y-0.5",
        "focus-visible:ring-ring/60 focus-visible:ring-2 focus-visible:outline-none",
        selected && "ring-ring/60 ring-2",
        engaged && "ring-tone-bad/60 ring-2",
      )}
    >
      {/* Only an inlet: qBittorrent's traffic arrives from below, and nothing
          leaves this card for another node — past it is the public swarm. */}
      <Handle type="target" position={Position.Bottom} id="into" className="!border-0 !bg-transparent" />

      <header className="flex items-start gap-2 px-3 pt-3 pb-2">
        <Shield className={cn("mt-px size-4 shrink-0", engaged ? "text-tone-bad" : "text-tone-accent")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] leading-tight font-semibold">{node.label}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <StatusDot status={node.status} />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {STATUS_LABEL[node.status]}
                {node.error ? ` — ${node.error}` : ""}
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-muted-foreground truncate text-[10px] leading-tight">{node.role}</p>
        </div>
        <a
          href={node.link}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => event.stopPropagation()}
          title="Open the Proton account"
          className="text-muted-foreground hover:bg-muted hover:text-foreground -mt-0.5 -mr-1 rounded-md p-1 transition-colors"
        >
          <ArrowUpRight className="size-3.5" />
        </a>
      </header>

      {!vpn ? (
        <p className="text-tone-bad border-border/60 border-t px-3 py-3 text-[11px] leading-snug">
          {node.error ?? "no data"}
        </p>
      ) : (
        <>
          {/* The exit, large: the one fact the whole tunnel exists to change. */}
          <div
            className={cn(
              "border-border/60 relative border-t px-3 py-3",
              engaged ? "bg-tone-bad/[0.07]" : "bg-tone-accent/[0.06]",
            )}
          >
            <FieldLabel>{engaged ? "Tunnel" : "Peers see the box in"}</FieldLabel>
            <div className="mt-1 flex items-center gap-2">
              <Globe2 className={cn("size-4 shrink-0", engaged ? "text-tone-bad" : "text-tone-accent")} />
              <span className={cn("truncate text-[15px] leading-tight font-semibold", engaged && "text-tone-bad")}>
                {engaged ? "held down" : (where ?? "—")}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 truncate font-mono text-[10.5px]">
              {engaged
                ? "no exit · gluetun's firewall blocks everything"
                : vpn.exit
                  ? `${vpn.exit.ip} · ${vpn.exit.org || vpn.exit.hostname}`
                  : "waiting for an exit"}
            </p>
          </div>

          <div className="border-border/60 grid gap-1.5 border-t px-3 py-2.5">
            <Row
              label="Forwarded port"
              value={vpn.forwardedPort ? String(vpn.forwardedPort) : "none"}
              ok={engaged || !t ? null : t.portMatches}
              title={t?.listenPort ? `qBittorrent is listening on ${t.listenPort}` : "qBittorrent is not listening"}
            />
            <Row
              label="qBittorrent bound to"
              value={t?.iface ?? "—"}
              ok={engaged ? null : t ? t.bound : null}
            />
            <Row
              label="Leak check"
              value={vpn.leak.clean === true ? "clean" : vpn.leak.clean === false ? "LEAKING" : "unchecked"}
              ok={vpn.leak.clean}
              title={vpn.leak.detail}
            />
            <Row label="gluetun up" value={since(vpn.since)} ok={null} />
          </div>

          <div className="border-border/60 border-t px-3 py-2.5">
            <KillSwitch vpn={vpn} onChanged={onChanged} />
          </div>
        </>
      )}

      <footer className="text-muted-foreground border-border/60 flex items-center gap-3 border-t px-3 py-1.5 text-[10px]">
        {node.load ? (
          <>
            <span className="inline-flex items-center gap-1" title="gluetun CPU">
              <Cpu className="size-3" />
              <span className="tnum">{node.load.cpuPercent.toFixed(node.load.cpuPercent < 10 ? 1 : 0)}%</span>
            </span>
            <span className="inline-flex items-center gap-1" title="gluetun memory">
              <MemoryStick className="size-3" />
              <span className="tnum">{node.load.rssDisplay}</span>
            </span>
          </>
        ) : null}
        <span className="ml-auto truncate font-mono">
          {vpn ? `${vpn.provider} · ${vpn.protocol}` : ""}
        </span>
      </footer>
    </div>
  );
}

export const VpnNode = memo(VpnNodeImpl);
