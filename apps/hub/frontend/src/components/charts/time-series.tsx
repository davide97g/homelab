import type { SeriesFrame } from "@wire";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { formatValue, readTheme, type ChartTheme } from "@/components/charts/theme";
import { cn } from "@/lib/utils";

/** uPlot rather than a React chart library.
 *
 *  9 kB gzipped against Recharts' ~100, canvas instead of a DOM node per point,
 *  and `setData` is designed for exactly this: the same series re-sent every few
 *  seconds. The cost is that it is imperative, so this wrapper owns the instance,
 *  the resize observer and the tooltip — paid once, free for every panel after.
 *
 *  Nothing here re-renders React on new data: `setData` is called on the existing
 *  instance and React only re-renders when the frame's *shape* changes. */
function toData(frame: SeriesFrame): uPlot.AlignedData {
  const x = frame.t;
  const ys = frame.lines.map((line) =>
    // Mirrored series are drawn below the axis. Negating here rather than in the
    // renderer keeps the axis and tooltip honest: they undo it for display.
    line.mirror ? line.values.map((v) => (v === null ? null : -v)) : line.values,
  );
  return [x, ...ys] as uPlot.AlignedData;
}

export function TimeSeries({
  frame,
  height = 200,
  className,
}: {
  frame: SeriesFrame | null;
  height?: number;
  className?: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const chart = useRef<uPlot | null>(null);
  const [theme, setTheme] = useState<ChartTheme | null>(null);
  const [cursor, setCursor] = useState<{ left: number; idx: number } | null>(null);

  // The canvas needs resolved colours, and they change when the theme flips.
  useEffect(() => {
    setTheme(readTheme());
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // The signature, not the data: rebuild the instance only when the shape
  // changes, and stream everything else through setData.
  const signature = useMemo(
    () => (frame ? `${frame.id}:${frame.kind}:${frame.lines.map((l) => l.key).join("|")}` : ""),
    [frame],
  );

  useEffect(() => {
    if (!frame || !host.current || !theme || frame.lines.length === 0) return;

    const stacked = frame.kind === "stack";
    const options: uPlot.Options = {
      width: host.current.clientWidth || 600,
      height,
      padding: [12, 8, 0, 0],
      legend: { show: false },
      cursor: {
        y: false,
        points: { size: 6 },
        drag: { x: false, y: false },
      },
      scales: {
        x: { time: true },
        y: {
          range: (_u, min, max) => {
            const lo = frame.domain?.[0] ?? null;
            const hi = frame.domain?.[1] ?? null;
            const hasMirror = frame.lines.some((l) => l.mirror);
            const bottom = lo !== null ? lo : hasMirror ? Math.min(min, 0) : Math.min(min, 0);
            const top = hi !== null ? hi : max * 1.08 || 1;
            return [bottom, top];
          },
        },
      },
      axes: [
        {
          stroke: theme.text,
          grid: { stroke: theme.grid, width: 1, dash: [2, 4] },
          ticks: { stroke: theme.grid, width: 1 },
          font: "11px Inter, sans-serif",
        },
        {
          stroke: theme.text,
          grid: { stroke: theme.grid, width: 1, dash: [2, 4] },
          ticks: { show: false },
          font: "11px Inter, sans-serif",
          size: 58,
          values: (_u, ticks) => ticks.map((v) => formatValue(Math.abs(v), frame.unit)),
        },
      ],
      series: [
        {},
        ...frame.lines.map((line, i): uPlot.Series => {
          const colour = theme.resolve(line.color, i);
          return {
            label: line.label,
            stroke: colour,
            width: line.dashed ? 1.5 : 1.75,
            dash: line.dashed ? [4, 4] : undefined,
            fill: line.area || stacked ? `color-mix(in srgb, ${colour} 22%, transparent)` : undefined,
            points: { show: false },
            // A gap is a gap. Joining across one hides that the box was not
            // answering, which is usually the thing you are looking for.
            spanGaps: false,
          };
        }),
      ],
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            setCursor(idx === null || idx === undefined ? null : { left: u.cursor.left ?? 0, idx });
          },
        ],
      },
    };

    const instance = new uPlot(options, toData(frame), host.current);
    chart.current = instance;

    const ro = new ResizeObserver(([entry]) => {
      if (entry) instance.setSize({ width: entry.contentRect.width, height });
    });
    ro.observe(host.current);

    return () => {
      ro.disconnect();
      instance.destroy();
      chart.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, theme, height]);

  // New data for the same shape: stream it in, no React render.
  useEffect(() => {
    if (chart.current && frame && frame.lines.length > 0) chart.current.setData(toData(frame));
  }, [frame]);

  if (!frame) {
    return <div className="neu-inset animate-pulse" style={{ height }} />;
  }

  if (frame.error) {
    return (
      <div className="text-muted-foreground flex items-center justify-center rounded-[10px] px-4 text-center text-xs" style={{ height }}>
        {frame.error}
      </div>
    );
  }

  if (frame.lines.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center text-xs" style={{ height }}>
        no data in this range
      </div>
    );
  }

  const hovered = cursor
    ? frame.lines
        .map((line) => ({ label: line.label, value: line.values[cursor.idx] ?? null, color: line.color }))
        .filter((r) => r.value !== null)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        .slice(0, 8)
    : [];

  return (
    <div className={cn("relative", className)}>
      <div ref={host} />

      {cursor && hovered.length > 0 && theme && (
        <div
          className="glass pointer-events-none absolute top-1 z-10 min-w-36 rounded-[10px] p-2 text-[11px] shadow-lg"
          style={{ left: Math.min(cursor.left + 12, (host.current?.clientWidth ?? 600) - 160) }}
        >
          <div className="text-muted-foreground mb-1">
            {new Date((frame.t[cursor.idx] ?? 0) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          {hovered.map((row, i) => (
            <div key={row.label} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 truncate">
                <span className="size-2 shrink-0 rounded-full" style={{ background: theme.resolve(row.color, i) }} />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="tnum shrink-0">{formatValue(row.value, frame.unit)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A titled panel with the chart inside, its legend under it, and the escape
 *  hatch in the corner: the same expressions, open in Grafana Explore. That link
 *  is what makes an id allow-list affordable — the registry never has to be
 *  complete, because the next question is one click away. */
export function Panel({
  frame,
  height,
  className,
}: {
  frame: SeriesFrame | null;
  height?: number;
  className?: string;
}) {
  const [theme, setTheme] = useState<ChartTheme | null>(null);
  useEffect(() => setTheme(readTheme()), []);

  return (
    <section className={cn("neu flex flex-col gap-2 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{frame?.title ?? "…"}</h2>
          {frame?.description && (
            <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">{frame.description}</p>
          )}
        </div>
        {frame?.grafana && (
          <a
            href={frame.grafana}
            target="_blank"
            rel="noreferrer"
            title="Open these queries in Grafana Explore"
            className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
          >
            <ArrowUpRight className="size-4" />
          </a>
        )}
      </div>

      <TimeSeries frame={frame} height={height} />

      {frame && frame.lines.length > 1 && theme && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
          {frame.lines.slice(0, 12).map((line, i) => (
            <span key={line.key} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: theme.resolve(line.color, i) }} />
              {/* Not FieldLabel: it uppercases, which turns 15m into 15M and a
                  container name into shouting. */}
              <span className="text-muted-foreground text-[11px]">{line.label}</span>
            </span>
          ))}
          {frame.lines.length > 12 && (
            <span className="text-muted-foreground text-[11px]">+{frame.lines.length - 12} more</span>
          )}
        </div>
      )}
    </section>
  );
}
