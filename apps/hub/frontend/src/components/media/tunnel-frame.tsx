import type { VpnSnapshot } from "@wire";
import type { Node, NodeProps } from "@xyflow/react";
import { Lock, ShieldAlert } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";

export type TunnelFrameData = { vpn: VpnSnapshot | null; width: number; height: number };
export type TunnelFrameNode = Node<TunnelFrameData, "tunnel">;

/** The WireGuard boundary around qBittorrent and its VPN.
 *
 *  The rest of the pipeline is a row of services that talk to each other. This
 *  pair is different in kind — qBittorrent has no network of its own, it lives
 *  in gluetun's — and a box drawn around both says that faster than any label
 *  on an edge could. Everything outside the frame reaches the internet on the
 *  home line; the only thing inside it does not.
 *
 *  Purely a picture: no handles, not selectable, drawn behind its contents. */
function TunnelFrameImpl({ data }: NodeProps<TunnelFrameNode>) {
  const { vpn, width, height } = data;
  const cut = vpn?.killSwitch ?? false;
  const up = vpn?.tunnel === "running";

  return (
    <div
      aria-hidden
      style={{ width, height }}
      className={cn(
        "pointer-events-none relative rounded-2xl border-2 border-dashed transition-colors duration-300",
        cut
          ? "border-tone-bad/60 bg-tone-bad/[0.04]"
          : up
            ? "border-tone-accent/45 bg-tone-accent/[0.035]"
            : "border-muted-foreground/30 bg-muted/20",
      )}
    >
      <div
        className={cn(
          "absolute top-2.5 left-3.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase",
          cut ? "text-tone-bad" : up ? "text-tone-accent" : "text-muted-foreground",
        )}
      >
        {cut ? <ShieldAlert className="size-3" /> : <Lock className="size-3" />}
        {cut ? "tunnel cut · kill switch" : "WireGuard tunnel · gluetun"}
      </div>
      <p className="text-muted-foreground absolute right-3.5 bottom-2 left-3.5 truncate text-[9.5px]">
        qBittorrent's only interface — everything outside this box uses the home line
      </p>
    </div>
  );
}

export const TunnelFrame = memo(TunnelFrameImpl);
