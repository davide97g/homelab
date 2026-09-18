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
      className="neu-inset h-[min(62vh,640px)] overflow-y-auto p-1 font-mono text-[11.5px] leading-[1.55]"
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
              className="hover:bg-chip/60 animate-in fade-in-0 grid grid-cols-[auto_auto_1fr] gap-x-3 rounded-[6px] px-2 py-[1px] transition-colors duration-150"
            >
              <span className="text-muted-foreground tnum shrink-0">{clock(l.atMs)}</span>
              <span
                className={cn("shrink-0 truncate", LEVEL_CLASS[l.level])}
                title={`${l.host} · ${l.job} · ${l.source}${l.level === "unknown" ? "" : ` · ${l.level}`}`}
              >
                {l.source}
              </span>
              {/* break-all rather than truncate: a stack trace or a long URL is
                  usually the whole reason you opened this page. */}
              <span className="break-all whitespace-pre-wrap">{l.line}</span>
            </div>
          ))}
          {live && <div className="text-muted-foreground px-2 py-1 font-sans text-[10px]">tailing…</div>}
        </div>
      )}
    </div>
  );
}
