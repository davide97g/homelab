import type { Range } from "@wire";
import { cn } from "@/lib/utils";

/** The pill nav from the reference designs, doing real work. The server's own
 *  list lives in prom/series.ts; both are typed Range[], so if they ever
 *  disagree the build fails rather than a request. */
const RANGES: Range[] = ["15m", "1h", "6h", "24h", "7d", "30d"];

export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="neu-inset flex gap-0.5 p-0.5" role="group" aria-label="Time range">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          aria-pressed={r === value}
          className={cn(
            "rounded-[calc(var(--radius)-0.75rem)] px-2.5 py-1 text-[11px] font-medium transition-colors",
            r === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
