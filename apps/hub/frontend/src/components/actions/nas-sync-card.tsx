import type { ActionResult, NasSyncSnapshot } from "@wire";
import { HardDriveUpload, Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FieldLabel, MiniBar, StatusDot, TONE_TEXT } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePoll } from "@/hooks/use-poll";
import { fetchNasSync, runAction } from "@/lib/api";
import { sinceLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const OUTCOME_TONE = { done: "good", paused: "accent", full: "warn", failed: "bad" } as const;

/** Show the last part of a library path: the film or series folder and the file. */
function shortPath(rel: string): string {
  const parts = rel.split("/");
  return parts.length > 2 ? `${parts[1]} › ${parts[parts.length - 1]}` : rel;
}

/** The switch for nas-sync.sh on the box: new library files copied to the NAS
 *  as they arrive. Files that were in the library when it was installed are
 *  never sent, whatever the switch says.
 *
 *  Like the VPN kill switch, two actions rather than a toggle, and the one sent
 *  is decided by the state the dialog opened on. */
export function NasSyncCard({ onChanged }: { onChanged?: () => void }) {
  const load = useCallback((signal: AbortSignal) => fetchNasSync(signal), []);
  const { data, error, refresh } = usePoll<NasSyncSnapshot>(load, 5_000);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const key = useRef<string | null>(null);

  useEffect(() => {
    if (!result) return;
    const id = setTimeout(() => setResult(null), 8000);
    return () => clearTimeout(id);
  }, [result]);

  if (!data) {
    return (
      <section className="space-y-2">
        <FieldLabel>NAS sync</FieldLabel>
        <div className="neu text-muted-foreground p-4 text-sm">{error ?? "Reading the NAS sync…"}</div>
      </section>
    );
  }

  const on = data.enabled;
  const intent = on ? "disable" : "enable";

  async function fire() {
    key.current ??= crypto.randomUUID();
    setPending(true);
    try {
      const res = await runAction({ action: `nas-sync.${intent}`, key: key.current, confirm: true });
      setResult(res);
      if (res.ok) {
        key.current = null;
        setOpen(false);
        refresh();
        onChanged?.();
      }
    } catch (err) {
      setResult({
        ok: false,
        action: `nas-sync.${intent}`,
        outcome: "failed",
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      });
    } finally {
      setPending(false);
    }
  }

  const { current } = data;
  const status = !data.configured || data.stale ? "down" : on ? "up" : "warn";
  const ready = data.queue.filter((q) => !q.settling).length;
  const headline = !data.configured
    ? "Not installed"
    : current
      ? current.phase === "verify"
        ? "Verifying a copy"
        : "Copying to the NAS"
      : on
        ? "On — watching for new files"
        : "Off — new files queue here";

  return (
    <section className="space-y-2">
      <FieldLabel>NAS sync</FieldLabel>
      <div className="neu space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <StatusDot status={status} />
            <h3 className="text-sm font-semibold">{headline}</h3>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={on ? "Turn NAS sync off" : "Turn NAS sync on"}
            disabled={!data.configured || pending}
            onClick={() => {
              key.current = null;
              setOpen(true);
            }}
            className={cn(
              "focus-visible:ring-ring/60 relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
              on ? "bg-tone-good" : "bg-muted-foreground/35",
            )}
          >
            {pending ? (
              <Loader2 className="text-background absolute top-1 left-[14px] size-4 animate-spin" />
            ) : (
              <span
                className={cn(
                  "bg-background absolute top-1 size-4 rounded-full shadow-sm transition-all duration-200",
                  on ? "left-6" : "left-1",
                )}
              />
            )}
          </button>
        </div>

        {current && (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-[11.5px]">
              <span className="truncate font-mono" title={current.file}>
                {shortPath(current.file)}
              </span>
              <span className="text-muted-foreground tnum shrink-0">
                {current.phase === "verify" ? "md5 on both ends" : current.display}
              </span>
            </div>
            <MiniBar value={current.total > 0 ? current.bytes / current.total : 0} tone="accent" />
          </div>
        )}

        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-[11.5px]">
          <dt className="text-muted-foreground">Waiting</dt>
          <dd>
            {data.queue.length === 0
              ? "nothing"
              : `${data.queue.length} file(s), ${data.queueSize}${ready < data.queue.length ? ` · ${data.queue.length - ready} still settling` : ""}`}
          </dd>
          <dt className="text-muted-foreground">Sent so far</dt>
          <dd>
            {data.doneCount} file(s) · {data.baselineCount} older file(s) are never sent
          </dd>
          <dt className="text-muted-foreground">NAS free</dt>
          <dd>{data.nasFree ?? "—"}</dd>
          <dt className="text-muted-foreground">Last run</dt>
          <dd className={cn(data.stale && TONE_TEXT.bad)}>
            {data.lastRun ? `${sinceLabel(data.lastRun.at)} ago: ${data.lastRun.note}` : "never"}
            {data.stale && " — the timer on the box looks stopped"}
          </dd>
        </dl>

        {data.queue.length > 0 && (
          <ul className="border-border space-y-0.5 border-t pt-2 text-[11px]">
            {data.queue.slice(0, 8).map((q) => (
              <li key={q.file} className="flex justify-between gap-3">
                <span className={cn("truncate font-mono", q.settling && "text-muted-foreground")} title={q.file}>
                  {shortPath(q.file)}
                </span>
                <span className="text-muted-foreground tnum shrink-0">{q.settling ? "settling" : q.size}</span>
              </li>
            ))}
            {data.queue.length > 8 && <li className="text-muted-foreground">…and {data.queue.length - 8} more</li>}
          </ul>
        )}

        {data.recent.length > 0 && (
          <ul className="border-border space-y-0.5 border-t pt-2 text-[11px]">
            {data.recent.slice(0, 5).map((r, i) => (
              <li key={`${r.at}-${i}`} className="flex items-baseline gap-3">
                <span className={cn("w-12 shrink-0 font-medium", TONE_TEXT[OUTCOME_TONE[r.outcome]])}>{r.outcome}</span>
                <span className="min-w-0 flex-1 truncate font-mono" title={`${r.file} — ${r.message}`}>
                  {shortPath(r.file)}
                </span>
                <span className="text-muted-foreground tnum shrink-0" title={r.at}>
                  {sinceLabel(r.at)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {data.error && <p className={cn("text-[11px]", TONE_TEXT.warn)}>{data.error}</p>}
        {result && !result.ok && (
          <p className="text-tone-bad flex items-start gap-1 text-[11px]">
            <TriangleAlert className="mt-px size-3 shrink-0" />
            <span className="break-words">{result.message}</span>
          </p>
        )}
      </div>

      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HardDriveUpload className="size-5" />
              {intent === "enable" ? "Turn NAS sync on?" : "Turn NAS sync off?"}
            </DialogTitle>
            <DialogDescription>
              {intent === "enable"
                ? `New library files are copied to the NAS one at a time and md5-verified.${
                    data.queue.length > 0 ? ` ${data.queue.length} file(s) (${data.queueSize}) are already waiting and go first.` : ""
                  } The ${data.baselineCount} file(s) that were in the library before are never sent.`
                : current
                  ? `${shortPath(current.file)} stops within a few seconds and resumes from the same byte when sync is back on. New files keep queueing.`
                  : "Nothing is copying right now. New files keep queueing until it is back on."}
            </DialogDescription>
          </DialogHeader>
          {result && !result.ok && <p className="text-tone-bad text-xs break-words">{result.message}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant={intent === "enable" ? "default" : "destructive"} disabled={pending} onClick={() => void fire()}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {intent === "enable" ? "Turn on" : "Stop syncing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
