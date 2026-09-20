import type { Range } from "@wire";
import { Segmented } from "@/components/primitives";

/** The server's own list lives in prom/series.ts; both are typed Range[], so if
 *  they ever disagree the build fails rather than a request. */
const RANGES: Range[] = ["15m", "1h", "6h", "24h", "7d", "14d", "30d"];

export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return <Segmented options={RANGES} value={value} onChange={onChange} label="Time range" />;
}
