import { useMemo } from "react";
import { cn } from "@/lib/utils";

/** A stretch of telemetry, drawn once and reused.
 *
 *  Generated rather than hand-written so it has the texture of a real trace --
 *  a restless baseline with the occasional spike -- and seeded so it is the same
 *  stretch every time. A loading animation that reshuffles on every run reads as
 *  noise; one that is always the same reads as an instrument. */
function tracePath(width: number, height: number): string {
  const mid = height / 2;
  const headroom = mid - 1.5;
  const parts = [`M0 ${mid}`];

  let seed = 20260918;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  let x = 0;
  while (x < width - 40) {
    if (rand() > 0.82) {
      // A spike: up hard, overshoot down, settle. Three segments rather than a
      // curve, because a sampled signal has corners.
      const up = mid - headroom * (0.72 + rand() * 0.28);
      const down = mid + headroom * (0.45 + rand() * 0.4);
      parts.push(`L${x + 5} ${mid}`, `L${x + 10} ${up}`, `L${x + 16} ${down}`, `L${x + 23} ${mid}`);
      x += 23;
    } else {
      const step = 14 + rand() * 34;
      parts.push(`L${x + step} ${mid + (rand() - 0.5) * headroom * 0.62}`);
      x += step;
    }
  }

  parts.push(`L${width} ${mid}`);
  return parts.join(" ");
}

/** The sweep.
 *
 *  Two paths over one ghost, both normalised with `pathLength="100"` so the dash
 *  maths is in percent and nothing has to be measured at runtime. The dash
 *  pattern is offset from +100 to -100, which draws the segment in from the left
 *  and then drains it off the right: a scope sweep rather than a spinner, and it
 *  loops without a seam. The second path is a three-percent pip riding three
 *  units behind the leading edge, which is the part that sells it. */
export function Trace({
  height = 28,
  className,
  active = true,
}: {
  height?: number;
  className?: string;
  /** False leaves the geometry mounted but still and faint, so appearing and
   *  disappearing is a fade rather than a layout change. */
  active?: boolean;
}) {
  const width = 1200;
  const d = useMemo(() => tracePath(width, height), [height]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className={cn("trace", active && "trace-on", className)}
      aria-hidden
      focusable="false"
    >
      {/* Where the trace is going, so the sweep reads as revealing something
          that is there rather than inventing it. */}
      <path className="trace-ghost" d={d} pathLength={100} vectorEffect="non-scaling-stroke" />
      <path className="trace-line" d={d} pathLength={100} vectorEffect="non-scaling-stroke" />
      <path className="trace-head" d={d} pathLength={100} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The first screen, before there is anything to show.
 *
 *  It used to be the word "Loading…" in grey. This is the same sweep the header
 *  uses, so the app opens with its own handwriting, and the caption says which
 *  of the two waits you are in rather than covering both with one word. */
export function Booting({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6">
      <div className="flex items-center gap-2.5">
        <span className="bg-primary size-2.5 rounded-full" aria-hidden />
        <span className="text-[15px] font-semibold tracking-tight">homelab hub</span>
      </div>

      <div className="w-full max-w-md">
        <Trace height={44} />
      </div>

      <p className="text-muted-foreground text-xs" role="status">
        {label}
      </p>
    </div>
  );
}
