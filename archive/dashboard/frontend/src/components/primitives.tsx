import type { Status, Tone } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Amber has no slot in the shadcn palette and the chart ramp is all blues, so
 *  the one warning colour is written out here rather than faked from a token. */
export const WARN = "oklch(0.80 0.145 82)";

export const TONE_TEXT: Record<Tone, string> = {
  default: "text-foreground",
  good: "text-secondary",
  warn: "text-[oklch(0.80_0.145_82)]",
  bad: "text-destructive",
  accent: "text-accent",
};

export const TONE_BAR: Record<Tone, string> = {
  default: "bg-muted-foreground/50",
  good: "bg-secondary",
  warn: "bg-[oklch(0.80_0.145_82)]",
  bad: "bg-destructive",
  accent: "bg-accent",
};

export const STATUS_TONE: Record<Status, Tone> = {
  up: "good",
  warn: "warn",
  down: "bad",
  unconfigured: "default",
};

export const STATUS_LABEL: Record<Status, string> = {
  up: "healthy",
  warn: "degraded",
  down: "unreachable",
  unconfigured: "not configured",
};

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  const tone = STATUS_TONE[status];
  return (
    <span className={cn("relative flex size-2.5 items-center justify-center", className)}>
      {status === "up" && (
        <span className={cn("absolute inline-flex size-2.5 animate-ping rounded-full opacity-40", TONE_BAR[tone])} />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", TONE_BAR[tone])} />
    </span>
  );
}

export function MiniBar({ value, tone = "accent", className }: { value: number; tone?: Tone; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={cn("bg-muted/60 h-1 w-full overflow-hidden rounded-full", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-700", TONE_BAR[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The donut gauges under the chart in the reference design: a track ring, a
 *  progress arc, and the number in the middle. Drawn with stroke-dasharray so
 *  it animates smoothly without a chart library. */
export function Ring({
  value,
  label,
  caption,
  color,
  size = 74,
}: {
  /** 0..100 */
  value: number;
  label: string;
  caption: string;
  color: string;
  size?: number;
}) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - pct / 100);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted/70" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            stroke={color}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 700ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[15px] leading-none font-medium tabular-nums">{label}</span>
        </div>
      </div>
      <span className="text-muted-foreground text-[10px] tracking-wider uppercase">{caption}</span>
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground text-[9.5px] font-medium tracking-[0.14em] uppercase">{children}</span>;
}
