import type { HotspotState } from "@wire";
import { TONE_VAR } from "@/components/primitives";
import { cn } from "@/lib/utils";

/** An isometric UGREEN DXP4800 Pro in SVG, the NAS's half of the pair.
 *
 *  Same contract as `mini-pc-flat.tsx`: not a placeholder, but the renderer a
 *  phone, a reduced-motion preference or a machine without WebGL gets, fed by
 *  exactly the same `HotspotState` map the 3D scene reads.
 *
 *  Proportions follow the real chassis: an upright tower, four bay doors stacked
 *  down the front, the status LED above them, the fan grille on the rear flank.
 *  Empty bays are drawn dark and matte on purpose — three unlit bays next to a
 *  single-member array is the entire storage story in one glance, and softening
 *  it would be a lie told in pixels. */
export function NasFlat({
  hotspots,
  className,
}: {
  hotspots: Record<string, HotspotState>;
  className?: string;
}) {
  const led = hotspots.led;
  const fan = hotspots.fan;
  const nic = hotspots.nic0;

  // The front face as a parallelogram: A top-left, B top-right (the near edge),
  // D bottom-left. Every bay is placed in (u, v) across it, so moving the
  // chassis is four numbers rather than sixteen.
  const A = [78, 74] as const;
  const U = [92, 44] as const;
  const V = [0, 96] as const;
  const at = (u: number, v: number) => [A[0] + U[0] * u + V[0] * v, A[1] + U[1] * u + V[1] * v] as const;
  const quad = (u0: number, u1: number, v0: number, v1: number) =>
    [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  const ledColor = led ? TONE_VAR[led.tone] : "var(--tone-default)";
  const ledLevel = 0.3 + 0.7 * (led?.level ?? 0);
  const fanColor = fan ? TONE_VAR[fan.tone] : "var(--tone-default)";
  const nicLevel = nic?.level ?? 0;

  return (
    <svg
      viewBox="0 0 340 250"
      className={cn("h-auto w-full max-w-[420px]", className)}
      role="img"
      aria-label="NAS, with live status"
    >
      <defs>
        <linearGradient id="nas-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.44 0.010 250)" />
          <stop offset="100%" stopColor="oklch(0.32 0.008 250)" />
        </linearGradient>
        <linearGradient id="nas-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.31 0.008 250)" />
          <stop offset="100%" stopColor="oklch(0.22 0.006 250)" />
        </linearGradient>
        <linearGradient id="nas-side" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.37 0.008 250)" />
          <stop offset="100%" stopColor="oklch(0.27 0.006 250)" />
        </linearGradient>
        <pattern id="nas-grille" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.1" fill="oklch(0.15 0.005 250)" opacity="0.85" />
        </pattern>
        <filter id="nas-soft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      <ellipse cx="170" cy="228" rx="104" ry="15" fill="var(--glass-shadow)" filter="url(#nas-soft)" />

      {/* Chassis. */}
      <polygon points="78,74 170,30 262,74 170,118" fill="url(#nas-top)" />
      <polygon points="78,74 170,118 170,214 78,170" fill="url(#nas-front)" />
      <polygon points="262,74 170,118 170,214 262,170" fill="url(#nas-side)" />

      {/* Four bay doors. Occupied ones carry the pool's fill as a lit strip down
          their inner edge; empty ones stay matte. */}
      {[0, 1, 2, 3].map((i) => {
        const bay = hotspots[`bay${i}`];
        const v0 = 0.055 + i * 0.235;
        const v1 = v0 + 0.185;
        const lit = Boolean(bay && bay.level > 0) || bay?.value !== "empty";
        const tone = bay ? TONE_VAR[bay.tone] : "var(--tone-default)";
        return (
          <g key={i}>
            <polygon points={quad(0.07, 0.93, v0, v1)} fill="oklch(0.19 0.006 250)" opacity="0.95" />
            <polygon points={quad(0.09, 0.91, v0 + 0.012, v1 - 0.012)} fill="url(#nas-grille)" opacity={lit ? 0.5 : 0.85} />
            {/* The handle slot, and the activity LED beside it. */}
            <polygon points={quad(0.73, 0.88, v0 + 0.05, v1 - 0.05)} fill="oklch(0.14 0.005 250)" opacity="0.9" />
            <circle
              cx={at(0.14, (v0 + v1) / 2)[0]}
              cy={at(0.14, (v0 + v1) / 2)[1]}
              r={3.2}
              fill={lit ? tone : "oklch(0.24 0.006 250)"}
              opacity={lit ? 0.35 + 0.65 * (bay?.level ?? 0) : 1}
              className="transition-opacity duration-700"
            />
          </g>
        );
      })}

      {/* Status LED, above the bays on the top face's front lip. */}
      <g>
        <circle cx={at(0.5, -0.03)[0]} cy={at(0.5, -0.03)[1]} r="10" fill={ledColor} opacity={ledLevel * 0.3} filter="url(#nas-soft)" />
        <circle
          cx={at(0.5, -0.03)[0]}
          cy={at(0.5, -0.03)[1]}
          r="3.4"
          fill={ledColor}
          opacity={ledLevel}
          className="transition-opacity duration-700"
        >
          {led && led.pulse > 0 && (
            <animate
              attributeName="opacity"
              values={`${ledLevel};${Math.max(0.15, ledLevel * 0.4)};${ledLevel}`}
              dur={`${(1 / Math.max(0.2, led.pulse)).toFixed(2)}s`}
              repeatCount="indefinite"
            />
          )}
        </circle>
      </g>

      {/* Rear fan grille on the far flank, warming with the hottest sensor. */}
      <g transform="translate(216 116)">
        <ellipse rx="26" ry="30" fill="oklch(0.17 0.005 250)" opacity="0.9" />
        <ellipse rx="22" ry="26" fill={fanColor} opacity={0.10 + 0.55 * (fan?.level ?? 0)} className="transition-opacity duration-700" />
        {[0, 1, 2, 3, 4].map((i) => (
          <ellipse key={i} rx="22" ry={4 - i * 0.2} cy={-18 + i * 9} fill="oklch(0.14 0.005 250)" opacity="0.55" />
        ))}
      </g>

      {/* The 2.5 GbE port LED on the rear flank. */}
      <g>
        <circle cx="240" cy="168" r="8" fill="var(--tone-accent)" opacity={nicLevel * 0.3} filter="url(#nas-soft)" />
        <circle cx="240" cy="168" r="3" fill="var(--tone-accent)" opacity={0.3 + 0.7 * nicLevel} className="transition-opacity duration-700">
          {nic && nic.pulse > 0 && (
            <animate
              attributeName="opacity"
              values={`${0.3 + 0.7 * nicLevel};0.15;${0.3 + 0.7 * nicLevel}`}
              dur={`${(1 / Math.max(0.5, nic.pulse)).toFixed(2)}s`}
              repeatCount="indefinite"
            />
          )}
        </circle>
      </g>

      {/* Feet. */}
      <ellipse cx="96" cy="176" rx="6" ry="2.4" fill="oklch(0.14 0.005 250)" opacity="0.7" />
      <ellipse cx="246" cy="176" rx="6" ry="2.4" fill="oklch(0.14 0.005 250)" opacity="0.7" />
    </svg>
  );
}
