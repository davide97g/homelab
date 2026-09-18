import type { SensorRow } from "@wire";
import { HEALTH_TONE, MiniBar, TONE_TEXT } from "@/components/primitives";
import { cn } from "@/lib/utils";

/** Every temperature sensor by its kernel label, hottest first.
 *
 *  The bar is scaled 30–90 °C rather than 0–100: nothing in a house is ever near
 *  0 °C, so a bar anchored there would show every sensor as a third full and
 *  tell you nothing about the spread between them. */
export function SensorList({ sensors, limit = 12 }: { sensors: SensorRow[]; limit?: number }) {
  if (sensors.length === 0) {
    return <p className="text-muted-foreground text-xs">No hwmon sensors are being reported.</p>;
  }

  return (
    <div className="grid gap-2">
      {sensors.slice(0, limit).map((s) => (
        <div key={s.key} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[12px]">
              <span className="font-medium">{s.chip}</span>
              <span className="text-muted-foreground"> {s.label}</span>
            </span>
            <span className={cn("tnum shrink-0 text-[11.5px] font-medium", TONE_TEXT[HEALTH_TONE[s.health]])}>
              {s.display}
            </span>
          </div>
          <MiniBar
            value={s.tempC === null ? 0 : (s.tempC - 30) / 60}
            tone={HEALTH_TONE[s.health]}
          />
        </div>
      ))}
    </div>
  );
}
