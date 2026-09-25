import type { LogLine } from "@wire";
import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Four levels, four weights of attention. `unknown` is the common case for a
 *  container that writes plain text, so it must read as ordinary rather than as
 *  a problem. */
const LEVEL_CLASS: Record<LogLine["level"], string> = {
  error: "text-tone-bad",
  warn: "text-tone-warn",
  info: "text-tone-accent",
  debug: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

function clock(atMs: number): string {
  const d = new Date(atMs);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The log pane.
 *
 *  Not virtualised, and capped instead. A window is at most a thousand lines and
 *  the tail trims to two thousand, which the DOM handles without complaint; a
 *  virtualiser here would be a dependency and a scroll-restoration bug in
 *  exchange for nothing measurable.
 *
 *  Autoscroll only when the reader is already at the bottom. Scrolling away from
 *  the tail is how you read something, and yanking the view back every five
 *  seconds makes that impossible. */
export function LogView({
  lines,
  live,
  emptyMessage,
}: {
  lines: LogLine[];
  live: boolean;
  emptyMessage: string;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const el = pane.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={pane}
      // `dvh` rather than `vh`: on mobile Safari `vh` is the *large* viewport, so
      // a 62vh pane is taller than the space it is given and pushes the line
      // count and the query underneath it off the screen.
      className="neu-inset h-[min(68dvh,640px)] overflow-y-auto p-1 font-mono text-[11.5px] leading-[1.55] sm:h-[min(62dvh,640px)]"
    >
      {lines.length === 0 ? (
        <div className="text-muted-foreground flex h-full items-center justify-center font-sans text-sm">
          {emptyMessage}
        </div>
      ) : (
        <div className="min-w-0">
          {lines.map((l) => (
            <div
              key={l.id}
              // Three columns on a desktop, two rows on a phone. Time and source
              // together are a fixed ~200px, which on a 390px screen left the
              // message -- the only part anyone reads -- a ten-character ribbon
              // wrapping every other word. Below `sm` the meta line sits above
              // the message and the message gets the whole width.
              className={cn(
                "hover:bg-chip/60 animate-in fade-in-0 grid gap-x-3 rounded-[6px] px-2 py-1 transition-colors duration-150",
                "grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_auto_1fr] sm:py-[1px]",
              )}
            >
              <span className="text-muted-foreground tnum shrink-0">{clock(l.atMs)}</span>
              <span
                className={cn("min-w-0 truncate sm:shrink-0", LEVEL_CLASS[l.level])}
                title={`${l.host} · ${l.job} · ${l.source}${l.level === "unknown" ? "" : ` · ${l.level}`}`}
              >
                {l.source}
              </span>
              {/* break-all rather than truncate: a stack trace or a long URL is
                  usually the whole reason you opened this page. */}
              <span className="col-span-2 break-all whitespace-pre-wrap sm:col-span-1">{l.line}</span>
            </div>
          ))}
          {live && <div className="text-muted-foreground px-2 py-1 font-sans text-[10px]">tailing…</div>}
        </div>
      )}
    </div>
  );
}
