import type { Health, Status, Tone } from "@wire";
import { cn } from "@/lib/utils";

// Ported from mediarr-dash, with one structural change: every tone is a CSS
// token. That app writes its amber as a literal OKLCH "because amber has no slot
// in the shadcn palette", which works in one permanently dark app and would mean
// hand-picking a second value per tone here. Token-driven maps get the dark
// theme for free.

export const TONE_TEXT: Record<Tone, string> = {
  default: "text-tone-default",
  good: "text-tone-good",
  warn: "text-tone-warn",
  bad: "text-tone-bad",
  accent: "text-tone-accent",
};

export const TONE_BG: Record<Tone, string> = {
  default: "bg-tone-default",
  good: "bg-tone-good",
  warn: "bg-tone-warn",
  bad: "bg-tone-bad",
  accent: "bg-tone-accent",
};

/** The CSS variable behind a tone, for the SVG and canvas drawing that cannot
 *  use a Tailwind class. */
export const TONE_VAR: Record<Tone, string> = {
  default: "var(--tone-default)",
  good: "var(--tone-good)",
  warn: "var(--tone-warn)",
  bad: "var(--tone-bad)",
  accent: "var(--tone-accent)",
};

export const HEALTH_TONE: Record<Health, Tone> = {
  ok: "good",
  warn: "warn",
  bad: "bad",
  unknown: "default",
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
        <span className={cn("absolute inline-flex size-2.5 animate-ping rounded-full opacity-40", TONE_BG[tone])} />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", TONE_BG[tone])} />
    </span>
  );
}

export function MiniBar({ value, tone = "accent", className }: { value: number; tone?: Tone; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={cn("neu-inset h-1.5 w-full overflow-hidden rounded-full", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-700", TONE_BG[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function FieldLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("text-muted-foreground text-[9.5px] font-medium tracking-[0.14em] uppercase", className)}>
      {children}
    </span>
  );
}

/** The dial from both design references: a tick ring, a track, a progress arc
 *  and the number in the middle.
 *
 *  Drawn by hand rather than pulled from a chart library, because a gauge from a
 *  chart library always looks like a gauge from a chart library, and this is
 *  thirty lines of trigonometry. `sweep` picks the big hero dial (270°) or the
 *  small ones that sit on a card (180°). */
export function ArcGauge({
  value,
  min = 0,
  max,
  label,
  caption,
  tone = "accent",
  sweep = 270,
  size = 132,
  ticks = 28,
  children,
  className,
}: {
  value: number | null;
  min?: number;
  max: number;
  label: string;
  caption?: string;
  tone?: Tone;
  sweep?: 180 | 240 | 270;
  size?: number;
  ticks?: number;
  children?: React.ReactNode;
  className?: string;
}) {
  const stroke = Math.max(6, size * 0.075);
  const r = (size - stroke) / 2 - size * 0.09;
  const c = size / 2;
  // Angles run clockwise from 12 o'clock, so 180 is the bottom. The unswept gap
  // is centred there, which puts the start at 180 + gap/2: bottom-left for a
  // 270 gauge, due left for a 180 one.
  const start = 180 + (360 - sweep) / 2;
  const fraction = value === null || max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));

  const polar = (angleDeg: number, radius: number) => {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    return [c + radius * Math.cos(a), c + radius * Math.sin(a)] as const;
  };

  const arc = (fromFraction: number, toFraction: number, radius: number) => {
    const a0 = start + sweep * fromFraction;
    const a1 = start + sweep * toFraction;
    const [x0, y0] = polar(a0, radius);
    const [x1, y1] = polar(a1, radius);
    const large = sweep * (toFraction - fromFraction) > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1}`;
  };

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${value ?? "unknown"}`}>
        {/* Tick ring. Purely decorative, and the thing that makes it read as an
            instrument rather than a progress circle. */}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const f = i / ticks;
          const a = start + sweep * f;
          const lit = f <= fraction;
          const [x0, y0] = polar(a, r + stroke * 0.85);
          const [x1, y1] = polar(a, r + stroke * (lit ? 1.5 : 1.3));
          return (
            <line
              key={i}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke={lit ? TONE_VAR[tone] : "var(--border)"}
              strokeWidth={1.5}
              strokeLinecap="round"
              opacity={lit ? 0.9 : 0.55}
            />
          );
        })}

        <path d={arc(0, 1, r)} fill="none" stroke="var(--border)" strokeWidth={stroke} strokeLinecap="round" opacity={0.6} />
        {value !== null && fraction > 0 && (
          <path
            d={arc(0, fraction, r)}
            fill="none"
            stroke={TONE_VAR[tone]}
            strokeWidth={stroke}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        )}
      </svg>

        {/* The unswept gap sits at the bottom, so the arithmetic centre of the
            circle is also the optical centre of the dial. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {children}
        </div>
      </div>

      <FieldLabel>{label}</FieldLabel>
      {caption && <span className="text-muted-foreground -mt-0.5 text-[11px]">{caption}</span>}
    </div>
  );
}

/** A small donut, for the four-up rows where a full dial would be too much. */
export function Ring({
  value,
  label,
  caption,
  tone = "accent",
  size = 74,
}: {
  value: number | null;
  label: string;
  caption?: string;
  tone?: Tone;
  size?: number;
}) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} opacity={0.6} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={TONE_VAR[tone]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct / 100)}
            className="transition-[stroke-dashoffset] duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-sm font-semibold">{caption ?? `${Math.round(pct)}%`}</span>
        </div>
      </div>
      <FieldLabel>{label}</FieldLabel>
    </div>
  );
}

/** The pill group used for ranges, machines and anything else with a handful of
 *  mutually exclusive options. Three copies of this had appeared by the third
 *  page, which is where it stopped being a coincidence. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly T[] | readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  className?: string;
}) {
  const items = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));

  return (
    <div className={cn("neu-inset flex gap-0.5 p-0.5", className)} role="group" aria-label={label}>
      {items.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={cn(
            "rounded-[calc(var(--radius)-0.75rem)] px-2.5 py-1 text-[11px] font-medium transition-colors",
            o.value === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The same pills, but any number of them can be on at once. Used for log
 *  levels, where "errors and warnings" is the question you actually ask. */
export function Toggles<T extends string>({
  options,
  value,
  onChange,
  label,
  toneOf,
  className,
}: {
  options: readonly T[];
  value: T[];
  onChange: (next: T[]) => void;
  label: string;
  toneOf?: (option: T) => Tone;
  className?: string;
}) {
  return (
    <div className={cn("neu-inset flex gap-0.5 p-0.5", className)} role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            aria-pressed={on}
            className={cn(
              "rounded-[calc(var(--radius)-0.75rem)] px-2.5 py-1 text-[11px] font-medium transition-colors",
              on ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
              on && toneOf ? TONE_TEXT[toneOf(o)] : on && "text-foreground",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
