import { TONE_BG, type Tone } from "@/lib/state";

/** A hairline of progress. Width is the only thing that animates. */
export function Progress({ value, tone }: { value: number; tone: Tone }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className="h-[3px] w-full overflow-hidden rounded-full bg-surface-3"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full ${TONE_BG[tone]}`}
        style={{ width: `${pct}%`, transition: "width var(--dur-base) var(--ease)" }}
      />
    </div>
  );
}
