/** qBittorrent's "no idea" ETA. Not a hundred days -- render it as a dash. */
export const NO_ETA = 8_640_000;

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** Bytes, split so the caller can set the unit at a smaller size than the figure. */
export function splitBytes(n: number): { value: string; unit: string } {
  if (!Number.isFinite(n) || n <= 0) return { value: "0", unit: "B" };
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return { value: v.toFixed(digits), unit: UNITS[i] };
}

export function bytes(n: number): string {
  const { value, unit } = splitBytes(n);
  return `${value} ${unit}`;
}

export function speed(n: number): string {
  if (!n) return "0 B/s";
  return `${bytes(n)}/s`;
}

/** Compact duration: the two largest units that carry information. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return s ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

export function eta(seconds: number): string {
  if (!seconds || seconds >= NO_ETA) return "—";
  return duration(seconds);
}

export function ratio(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0.00";
  return n >= 100 ? "99+" : n.toFixed(2);
}

export function percent(progress: number): string {
  return `${Math.floor(progress * 1000) / 10}%`;
}

/** "3 days ago", for last activity. Deliberately coarse -- nobody acts on minutes. */
export function since(unixSeconds: number): string {
  if (!unixSeconds || unixSeconds < 0) return "never";
  const secs = Date.now() / 1000 - unixSeconds;
  if (secs < 90) return "just now";
  return `${duration(secs)} ago`;
}
