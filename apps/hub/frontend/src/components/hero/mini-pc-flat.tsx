import type { HotspotState } from "@wire";
import { TONE_VAR } from "@/components/primitives";
import { cn } from "@/lib/utils";

/** An isometric GMKtec M6 Ultra in SVG, with the same hotspots the WebGL model
 *  will drive.
 *
 *  This is not a placeholder to be thrown away: it is the fallback a phone, a
 *  reduced-motion preference or a machine without WebGL gets, and it is fed by
 *  exactly the same `HotspotState` map the 3D scene reads. One data path, two
 *  renderers.
 *
 *  Proportions follow the real box: a squat square chassis, mesh on the left
 *  flank, the round green power button front left, a row of front ports, and
 *  three heat-sink vents up the back. */
export function MiniPcFlat({
  hotspots,
  className,
}: {
  hotspots: Record<string, HotspotState>;
  className?: string;
}) {
  const power = hotspots.power;
  const vents = hotspots.vents;
  const nic = hotspots.nic;
  const nvme = hotspots.nvme;

  const ventColor = vents ? TONE_VAR[vents.tone] : "var(--tone-default)";
  const ventOpacity = 0.12 + 0.75 * (vents?.level ?? 0);
  const powerColor = power ? TONE_VAR[power.tone] : "var(--tone-good)";
  const powerGlow = 0.25 + 0.75 * (power?.level ?? 0);
  const nicLevel = nic?.level ?? 0;
  const nvmeLevel = nvme?.level ?? 0;

  return (
    <svg
      viewBox="0 0 340 250"
      className={cn("h-auto w-full max-w-[420px]", className)}
      role="img"
      aria-label="Mini PC, with live status"
    >
      <defs>
        <linearGradient id="hub-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.42 0.012 260)" />
          <stop offset="100%" stopColor="oklch(0.30 0.010 260)" />
        </linearGradient>
        <linearGradient id="hub-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.30 0.010 260)" />
          <stop offset="100%" stopColor="oklch(0.22 0.008 260)" />
        </linearGradient>
        <linearGradient id="hub-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.36 0.010 260)" />
          <stop offset="100%" stopColor="oklch(0.26 0.008 260)" />
        </linearGradient>
        <pattern id="hub-mesh" width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="3.5" cy="3.5" r="1.25" fill="oklch(0.16 0.006 260)" opacity="0.8" />
        </pattern>
        <filter id="hub-soft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* Contact shadow, so the box sits on something. */}
      <ellipse cx="172" cy="214" rx="118" ry="17" fill="var(--glass-shadow)" filter="url(#hub-soft)" />

      {/* Chassis: top face, front-left flank, right flank. */}
      <polygon points="60,88 172,36 286,88 172,140" fill="url(#hub-top)" />
      <polygon points="60,88 172,140 172,196 60,144" fill="url(#hub-left)" />
      <polygon points="286,88 172,140 172,196 286,144" fill="url(#hub-right)" />

      {/* Mesh grille on the left flank. */}
      <polygon points="74,101 160,141 160,180 74,140" fill="url(#hub-mesh)" opacity="0.85" />

      {/* Rear heat-sink vents on the right flank: three stacks of fins, warming
          with the hottest sensor. This is the temperature readout you notice
          without reading a number. */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <polygon
            points={`${196 + i * 28},${129 - i * 0} ${212 + i * 28},${121} ${212 + i * 28},${160} ${196 + i * 28},${168}`}
            fill="oklch(0.18 0.006 260)"
            opacity="0.9"
            transform={`translate(0 ${i * -6})`}
          />
          <polygon
            points={`${198 + i * 28},${130} ${210 + i * 28},${124} ${210 + i * 28},${158} ${198 + i * 28},${164}`}
            fill={ventColor}
            opacity={ventOpacity}
            transform={`translate(0 ${i * -6})`}
            className="transition-opacity duration-700"
          />
        </g>
      ))}

      {/* Power button: the thing your eye lands on, so it carries CPU load. */}
      <g>
        <circle cx="92" cy="128" r="14" fill={powerColor} opacity={powerGlow * 0.35} filter="url(#hub-soft)" />
        <circle cx="92" cy="128" r="7.5" fill="oklch(0.16 0.006 260)" />
        <circle
          cx="92"
          cy="128"
          r="6"
          fill={powerColor}
          opacity={powerGlow}
          className="transition-opacity duration-700"
        >
          {power && power.pulse > 0 && (
            <animate
              attributeName="opacity"
              values={`${powerGlow};${Math.max(0.2, powerGlow * 0.45)};${powerGlow}`}
              dur={`${(1 / Math.max(0.2, power.pulse)).toFixed(2)}s`}
              repeatCount="indefinite"
            />
          )}
        </circle>
        <path d="M92 124.4 v4" stroke="oklch(0.12 0 0)" strokeWidth="1.6" strokeLinecap="round" opacity="0.65" />
      </g>

      {/* Front ports: 3.5 mm, USB-C, two USB-A. The USB-A pair lights with disk
          throughput and the jack row stays inert -- nothing measures audio. */}
      <g opacity="0.95">
        <ellipse cx="110" cy="137" rx="3" ry="2.2" fill="oklch(0.14 0.005 260)" />
        <rect x="118" y="137" width="9" height="3.6" rx="1.8" fill="oklch(0.14 0.005 260)" transform="rotate(26 118 137)" />
        {[0, 1].map((i) => (
          <g key={i}>
            <rect
              x={132 + i * 14}
              y={144 + i * 6.5}
              width="11"
              height="4.6"
              rx="1"
              fill="oklch(0.13 0.005 260)"
              transform={`rotate(26 ${132 + i * 14} ${144 + i * 6.5})`}
            />
            <rect
              x={133 + i * 14}
              y={145 + i * 6.5}
              width="9"
              height="2.4"
              rx="0.8"
              fill="var(--tone-accent)"
              opacity={0.25 + 0.7 * nvmeLevel}
              transform={`rotate(26 ${133 + i * 14} ${145 + i * 6.5})`}
              className="transition-opacity duration-700"
            />
          </g>
        ))}
      </g>

      {/* The 2.5 GbE port LED, on the top face near the rear edge, standing in
          for the rear plate an isometric view cannot show. */}
      <g>
        <circle cx="236" cy="96" r="9" fill="var(--tone-accent)" opacity={nicLevel * 0.3} filter="url(#hub-soft)" />
        <circle cx="236" cy="96" r="3.2" fill="var(--tone-accent)" opacity={0.3 + 0.7 * nicLevel} className="transition-opacity duration-700">
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
      <ellipse cx="80" cy="150" rx="6" ry="2.4" fill="oklch(0.14 0.005 260)" opacity="0.7" />
      <ellipse cx="264" cy="150" rx="6" ry="2.4" fill="oklch(0.14 0.005 260)" opacity="0.7" />
    </svg>
  );
}
