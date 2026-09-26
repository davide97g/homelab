import type { ActionResult, VpnSnapshot } from "@wire";
import { Loader2, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { runAction } from "@/lib/api";
import { cn } from "@/lib/utils";

/** How long the control waits for the page's next poll to show the new state
 *  before it stops saying "engaging…" and trusts whatever the poll says. */
const SETTLE_MS = 20_000;

/** The VPN kill switch: a switch that never flips on one click.
 *
 *  Everywhere else in the hub a two-step button is enough confirmation — arm,
 *  then fire. This one gets a dialog, because what it does is not visible from
 *  where you click it: every torrent on the box stops, and the page you are on
 *  is the only thing that will tell you so. The dialog says exactly that before
 *  anything happens.
 *
 *  Two actions rather than a toggle. The switch shows the state the last poll
 *  read, and the action it sends is decided by that state when the dialog
 *  opens, so a stale page can at worst ask twice for what is already true —
 *  which gluetun treats as a no-op. */
export function KillSwitch({
  vpn,
  onChanged,
  className,
}: {
  vpn: VpnSnapshot | null;
  onChanged?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<"engage" | "release" | null>(null);
  const [settling, setSettling] = useState<boolean | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const key = useRef<string | null>(null);

  const engaged = vpn?.killSwitch ?? false;
  const unavailable = !vpn || vpn.tunnel === "unknown";

  // Settled once the poll reports the state that was asked for.
  useEffect(() => {
    if (settling === null) return;
    if (engaged === settling) {
      setSettling(null);
      return;
    }
    const id = setTimeout(() => setSettling(null), SETTLE_MS);
    return () => clearTimeout(id);
  }, [engaged, settling]);

  useEffect(() => {
    if (!result) return;
    const id = setTimeout(() => setResult(null), 8000);
    return () => clearTimeout(id);
  }, [result]);

  const intent = engaged ? "release" : "engage";
  const busy = pending !== null || settling !== null;

  async function fire() {
    key.current ??= crypto.randomUUID();
    setPending(intent);
    try {
      const res = await runAction({
        action: intent === "engage" ? "vpn.kill-switch" : "vpn.release",
        key: key.current,
        confirm: true,
      });
      setResult(res);
      if (res.ok) {
        key.current = null;
        setSettling(intent === "engage");
        setOpen(false);
        onChanged?.();
      }
    } catch (err) {
      setResult({
        ok: false,
        action: intent,
        outcome: "failed",
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      });
    } finally {
      setPending(null);
    }
  }

  const where = vpn?.exit ? [vpn.exit.city, vpn.exit.country].filter(Boolean).join(", ") : null;
  const stateLine = busy
    ? settling === true || pending === "engage"
      ? "engaging — cutting the tunnel…"
      : "releasing — reconnecting to Proton…"
    : unavailable
      ? "unavailable — gluetun is not answering"
      : engaged
        ? "engaged — torrents have no route out"
        : `off — torrents flowing via ${where ?? "Proton"}`;

  return (
    <div
      // Inside a React Flow node: without these a click on the switch would also
      // select the card, and a drag starting on it would move the card.
      // minmax(0, 1fr), not the default auto track: the state line is truncated,
      // and a nowrap line's min-content is its full width, which would push the
      // switch out past the edge of the card.
      className={cn("nodrag nopan grid grid-cols-[minmax(0,1fr)] gap-1.5", className)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
          engaged ? "border-tone-bad/50 bg-tone-bad/10" : "border-border/70 bg-muted/40",
        )}
      >
        {engaged ? (
          <ShieldAlert className="text-tone-bad size-4 shrink-0" />
        ) : (
          <ShieldCheck className="text-tone-good size-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] leading-tight font-semibold">Kill switch</p>
          <p
            className={cn(
              "truncate text-[10px] leading-tight",
              engaged ? "text-tone-bad" : "text-muted-foreground",
            )}
            title={stateLine}
          >
            {stateLine}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={engaged}
          aria-label={engaged ? "Release the kill switch" : "Engage the kill switch"}
          disabled={unavailable || busy}
          onClick={() => {
            key.current = null;
            setOpen(true);
          }}
          className={cn(
            "focus-visible:ring-ring/60 relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
            engaged ? "bg-tone-bad" : "bg-muted-foreground/35",
          )}
        >
          {busy ? (
            <Loader2 className="text-background absolute top-1 left-[14px] size-4 animate-spin" />
          ) : (
            <span
              className={cn(
                "bg-background absolute top-1 size-4 rounded-full shadow-sm transition-all duration-200",
                engaged ? "left-6" : "left-1",
              )}
            />
          )}
        </button>
      </div>

      {result && !result.ok && (
        <p className="text-tone-bad flex items-start gap-1 text-[10.5px] leading-snug">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          <span className="break-words">{result.message}</span>
        </p>
      )}

      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          {intent === "engage" ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldAlert className="text-tone-bad size-5" />
                  Engage the kill switch?
                </DialogTitle>
                <DialogDescription>
                  The ProtonVPN tunnel goes down and gluetun's firewall stays up, so qBittorrent is left with no route
                  out at all.
                </DialogDescription>
              </DialogHeader>
              <ul className="text-muted-foreground grid gap-1.5 text-[13px] leading-snug">
                <li>• Every torrent stops at once. Nothing is removed; qBittorrent keeps running.</li>
                <li>• Radarr and Sonarr downloads wait until you release it.</li>
                <li>• Nothing else on the box changes: Jellyfin, Tailscale and the tunnels stay up.</li>
                <li>• A redeploy of mediarr or a reboot of the box brings the tunnel back on its own.</li>
              </ul>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldCheck className="text-tone-good size-5" />
                  Release the kill switch?
                </DialogTitle>
                <DialogDescription>
                  gluetun reconnects to ProtonVPN, usually within five seconds, takes a new forwarded port and binds
                  qBittorrent to it. Torrents resume on their own.
                </DialogDescription>
              </DialogHeader>
            </>
          )}

          {result && !result.ok && <p className="text-tone-bad text-xs break-words">{result.message}</p>}

          <DialogFooter>
            <Button variant="outline" disabled={pending !== null} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={intent === "engage" ? "destructive" : "default"}
              disabled={pending !== null}
              onClick={() => void fire()}
              autoFocus={false}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {intent === "engage" ? "Cut the tunnel" : "Reconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
