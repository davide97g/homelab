import type { AskThreshold, CatalogEntry, SeriesFrame } from "@wire";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { formatValue, readTheme, type ChartTheme } from "@/components/charts/theme";
import { FieldLabel } from "@/components/primitives";
import type { Instance } from "@/hooks/use-series";
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
  slow = false,
  startedAt = null,
  threshold = null,
  className,
}: {
  frame: SeriesFrame | null;
  height?: number;
  /** A reference line across the plot. The only thing a panel draws that did not
   *  come out of the frame, because it did not come from Prometheus — it is what
   *  someone asked for on /api/ask. See the draw hook below. */
  threshold?: AskThreshold | null;
  /** Sets the probe's pace on the placeholder. The NAS takes visibly longer and
   *  a placeholder that pretends otherwise reads as a stall. */
  slow?: boolean;
  /** When this window started loading, for the elapsed readout. */
  startedAt?: number | null;
  className?: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const chart = useRef<uPlot | null>(null);
  // Read by the draw hook, which is created once and outlives any given value.
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;
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
  // The threshold is in here as well as in the ref: the ref keeps the hook
  // reading a current value between rebuilds, and the signature makes a *new*
  // threshold rebuild the instance, because the y scale has to be recomputed to
  // bring the line into view.
  const signature = useMemo(
    () =>
      frame
        ? `${frame.id}:${frame.kind}:${frame.lines.map((l) => l.key).join("|")}:${threshold?.value ?? ""}`
        : "",
    [frame, threshold?.value],
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
            let top = hi !== null ? hi : max * 1.08 || 1;
            // A threshold above everything plotted is the interesting case --
            // "warn me over 50" on a box that has never passed 45 -- and a line
            // drawn off the top of the canvas answers nothing.
            const mark = threshold?.value;
            if (mark !== undefined && mark > top) top = mark * 1.08;
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
          // Wide enough for the longest tick this formatter produces --
          // "400 Mbit/s" and "1.4 GiB/s" both overran the old 58 and were drawn
          // clipped at the left edge.
          size: 72,
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
        // Drawn rather than added as a constant series, deliberately: a series
        // would join the cursor tooltip, take a legend row, and drag the y
        // autoscale around. This is one line on the canvas and nothing else.
        draw: [
          (u: uPlot) => {
            const mark = thresholdRef.current;
            if (!mark) return;
            const y = Math.round(u.valToPos(mark.value, "y", true)) + 0.5;
            if (!Number.isFinite(y) || y < u.bbox.top || y > u.bbox.top + u.bbox.height) return;

            const { ctx } = u;
            ctx.save();
            ctx.strokeStyle = theme.resolve("tone-bad", 0);
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y);
            ctx.lineTo(u.bbox.left + u.bbox.width, y);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.font = "11px Inter, sans-serif";
            ctx.fillStyle = theme.resolve("tone-bad", 0);
            ctx.textAlign = "right";
            // Above the line where there is room, below it when the line is
            // near the top of the plot.
            const above = y - u.bbox.top > 16;
            ctx.textBaseline = above ? "bottom" : "top";
            ctx.fillText(mark.label, u.bbox.left + u.bbox.width - 4, above ? y - 3 : y + 3);
            ctx.restore();
          },
        ],
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
    return <Acquiring height={height} slow={slow} startedAt={startedAt} />;
  }

  if (frame.error) return <Blank height={height}>{frame.error}</Blank>;
  if (frame.lines.length === 0) return <Blank height={height}>no data in this range</Blank>;

  const hovered = cursor
    ? frame.lines
        .map((line) => ({ label: line.label, value: line.values[cursor.idx] ?? null, color: line.color }))
        .filter((r) => r.value !== null)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        .slice(0, 8)
    : [];

  return (
    <div className={cn("animate-in fade-in-0 relative duration-300", className)}>
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

/** A half with nothing to draw: a panel that does not apply to this machine, or
 *  a window with no samples in it. Framed rather than left as floating text,
 *  because next to a full chart an unframed sentence reads as a rendering
 *  failure rather than an answer. */
function Blank({ height, children }: { height: number; children: React.ReactNode }) {
  return (
    <div
      className="border-border/70 text-muted-foreground animate-in fade-in-0 flex items-center justify-center rounded-[10px] border border-dashed px-4 text-center text-[11px] duration-300"
      style={{ height }}
    >
      {children}
    </div>
  );
}

/** The placeholder a panel wears while its queries are out.
 *
 *  Deliberately not a grey pulsing block. See `.acquiring` in index.css for why,
 *  and note the elapsed readout only appears after a second and a half: a fast
 *  panel should never flash a number at you on its way in. */
function Acquiring({ height, slow, startedAt }: { height: number; slow: boolean; startedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const elapsed = startedAt === null ? 0 : (now - startedAt) / 1000;

  return (
    <div className={cn("acquiring relative", slow && "acquiring-slow")} style={{ height }}>
      <div className="absolute inset-x-0 bottom-2 flex justify-center">
        <span className="text-muted-foreground/70 text-[10px] tracking-wide">
          {elapsed >= 1.5 ? `querying prometheus · ${elapsed.toFixed(0)}s` : "querying prometheus"}
        </span>
      </div>
    </div>
  );
}

/** One machine's half of a panel: the chart, the legend under it, and the escape
 *  hatch to Grafana Explore for the exact expressions behind it. That link is
 *  what makes an id allow-list affordable — the registry never has to be
 *  complete, because the next question is one click away. */
function Side({
  frame,
  height,
  label,
  slow,
  startedAt,
  threshold = null,
}: {
  frame: SeriesFrame | null;
  height?: number;
  threshold?: AskThreshold | null;
  /** Null on a single-machine panel, where the card header already says which
   *  machine this is and repeating it would be noise. */
  label: Instance | null;
  slow: boolean;
  startedAt: number | null;
}) {
  const [theme, setTheme] = useState<ChartTheme | null>(null);
  useEffect(() => setTheme(readTheme()), []);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label && (
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>{label}</FieldLabel>
          {frame?.grafana && <GrafanaLink href={frame.grafana} />}
        </div>
      )}

      <TimeSeries frame={frame} height={height} slow={slow} startedAt={startedAt} threshold={threshold} />

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
    </div>
  );
}

function GrafanaLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Open these queries in Grafana Explore"
      className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
    >
      <ArrowUpRight className="size-4" />
    </a>
  );
}

export type PanelSide = {
  instance: Instance;
  frame: SeriesFrame | null;
  startedAt: number | null;
};

/** A titled panel holding one machine's chart, or both side by side.
 *
 *  The title comes from the catalog rather than the frame, so it is on screen
 *  before any data is — a loading panel that can name itself is a page laying
 *  itself out, and one that cannot is six anonymous grey boxes. */
export function Panel({
  entry,
  sides,
  height,
  threshold = null,
  className,
}: {
  entry: CatalogEntry | null;
  sides: PanelSide[];
  height?: number;
  /** Drawn on every side, so a comparison is read against one line rather than
   *  two that happen to coincide. */
  threshold?: AskThreshold | null;
  className?: string;
}) {
  const first = sides[0];
  const title = entry?.title ?? first?.frame?.title ?? "…";
  const description = entry?.description ?? first?.frame?.description;
  const compare = sides.length > 1;

  return (
    <section className={cn("neu flex flex-col gap-2 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">{description}</p>}
        </div>
        {!compare && first?.frame?.grafana && <GrafanaLink href={first.frame.grafana} />}
      </div>

      <div
        className={cn(
          "grid min-w-0 gap-4",
          // Side by side from `md` up, where two charts still have room to be
          // read; stacked below it, where they would be 150 px wide each and the
          // comparison would cost more than it gave. The per-half machine label
          // is what keeps the stacked version legible.
          compare &&
            "md:divide-border md:grid-cols-2 md:divide-x md:gap-0 md:[&>*+*]:pl-4 md:[&>*]:pr-4",
        )}
      >
        {sides.map((side) => (
          <Side
            key={side.instance}
            frame={side.frame}
            height={height}
            label={compare ? side.instance : null}
            slow={side.instance === "nas"}
            startedAt={side.startedAt}
            threshold={threshold}
          />
        ))}
      </div>
    </section>
  );
}
