import type { Filesystem, NasBay, RaidArray } from "@wire";
import { CircleAlert, CircleCheck, HardDrive, ShieldAlert } from "lucide-react";
import { FieldLabel, MiniBar, TONE_TEXT } from "@/components/primitives";
import { cn } from "@/lib/utils";

/** The four bays as data rather than as a picture. The chassis illustration says
 *  "three of these are dark"; this says which disk is in the one that is not,
 *  and what it is doing. */
export function BayStrip({ bays, poolPercent }: { bays: NasBay[]; poolPercent: number | null }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {bays.map((bay) => (
        <div
          key={bay.index}
          className={cn(
            "flex items-center gap-3 rounded-[12px] px-3 py-2.5",
            bay.occupied ? "neu-inset" : "border-border border border-dashed opacity-60",
          )}
        >
          <HardDrive className={cn("size-4 shrink-0", bay.occupied ? "text-tone-accent" : "text-muted-foreground")} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[12px] font-medium">{bay.label}</span>
              <span className="text-muted-foreground tnum shrink-0 text-[11px]">
                {bay.occupied ? (bay.ioDisplay ?? "—") : "empty"}
              </span>
            </div>
            {bay.occupied ? (
              <>
                <p className="text-muted-foreground text-[10.5px]">
                  {bay.rotational ? "spinning disk" : "solid state"} · capacity and SMART unreadable
                </p>
                {poolPercent !== null && <MiniBar className="mt-1.5" value={poolPercent / 100} tone="accent" />}
              </>
            ) : (
              <p className="text-muted-foreground text-[10.5px]">no disk</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The RAID picture, stated as it is.
 *
 *  This is the panel the whole page exists for. `node_md_degraded` reads 0 on
 *  this machine and will keep reading 0 until the single disk dies, so a green
 *  tick here would be technically true and completely misleading. The required
 *  member count decides the wording, not the state field. */
export function ArrayCard({ array }: { array: RaidArray }) {
  const unprotected = array.redundancy === "none";
  const bad = array.degraded || array.failed > 0;
  const tone = bad ? "bad" : unprotected ? "warn" : "good";
  const Icon = bad ? CircleAlert : unprotected ? ShieldAlert : CircleCheck;

  return (
    <div className="neu flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={cn("size-4", TONE_TEXT[tone])} />
          <span className="text-sm font-semibold">{array.device}</span>
        </div>
        <span className={cn("text-[11px] font-medium", TONE_TEXT[tone])}>
          {bad ? "degraded" : unprotected ? "no redundancy" : "protected"}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Stat label="state" value={array.state} />
        <Stat label="active" value={String(array.active)} />
        <Stat label="required" value={String(array.required)} />
        <Stat label="failed" value={String(array.failed)} />
      </div>

      {array.syncFraction !== null && (
        <div className="grid gap-1">
          <FieldLabel>resync {Math.round(array.syncFraction * 100)}%</FieldLabel>
          <MiniBar value={array.syncFraction} tone="warn" />
        </div>
      )}

      <p className="text-muted-foreground border-border border-t pt-3 text-[11.5px] leading-relaxed">{array.note}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <FieldLabel>{label}</FieldLabel>
      <span className="tnum text-[13px] font-medium">{value}</span>
    </div>
  );
}

export function FilesystemList({ filesystems }: { filesystems: Filesystem[] }) {
  return (
    <div className="grid gap-2.5">
      {filesystems.map((fs) => {
        const pct = fs.percent ?? 0;
        const tone = pct >= 90 ? "bad" : pct >= 80 ? "warn" : "accent";
        return (
          <div key={fs.mountpoint} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[12px] font-medium" title={fs.device}>
                {fs.mountpoint}
              </span>
              <span className="text-muted-foreground tnum shrink-0 text-[11px]">
                {fs.usedDisplay} / {fs.sizeDisplay} · {fs.percent === null ? "—" : `${fs.percent.toFixed(0)}%`}
              </span>
            </div>
            <MiniBar value={pct / 100} tone={tone} />
          </div>
        );
      })}
    </div>
  );
}
