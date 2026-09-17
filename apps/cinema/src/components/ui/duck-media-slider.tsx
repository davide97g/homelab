"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DuckMediaSlider — the waterline laid along the edge of a film.
 *
 * Same water as DuckSlider, and still a real <input type="range">, because
 * keyboard seeking, Home/End, PageUp/PageDown and touch dragging are browser
 * behaviour a div with role="slider" would have to reimplement badly. What a
 * seek bar needs on top: a dimmer second waterline for what has loaded, a
 * readout that runs along the track before you commit, and — dense — a 4px
 * line that only grows a duck when you reach for it.
 *
 * The design rule: while a drag is in flight this component is the sole author
 * of the value. Incoming `value` props are ignored until commit, because a
 * <video> fires timeupdate four times a second and would otherwise pull the
 * thumb back to the playhead between two of your own moves. Live position goes
 * out through onScrub; the seek itself goes out once, through onSeek.
 */

/**
 * Thumb width in px is not decoration here — every layer is positioned against
 * the thumb's centre, so the number has to be known in JS as well as CSS.
 */
const geometry = {
  default: {
    thumb: 18,
    row: "h-5",
    track: "h-1.5",
    box: "relative h-full",
    knob: cn(
      "[&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:border-[3px]",
      "[&::-moz-range-thumb]:size-[18px] [&::-moz-range-thumb]:border-[3px]",
      "active:[&::-webkit-slider-thumb]:scale-115"
    ),
  },
  dense: {
    thumb: 12,
    row: "h-4",
    track: "h-1",
    // The line is 4px, the grab area is 32px. The input is pulled out of the
    // row so the target clears WCAG 2.5.8 without the line getting fatter.
    box: "absolute inset-x-0 -inset-y-2",
    knob: cn(
      "[&::-webkit-slider-thumb]:size-[12px] [&::-webkit-slider-thumb]:border-2",
      "[&::-moz-range-thumb]:size-[12px] [&::-moz-range-thumb]:border-2",
      // At rest the whole control is 4px of line over the picture. The duck
      // arrives only once the pointer or the focus ring does.
      "[&::-webkit-slider-thumb]:scale-0 [&::-moz-range-thumb]:scale-0",
      "group-hover/seek:[&::-webkit-slider-thumb]:scale-100",
      "group-hover/seek:[&::-moz-range-thumb]:scale-100",
      "group-focus-within/seek:[&::-webkit-slider-thumb]:scale-100",
      "group-focus-within/seek:[&::-moz-range-thumb]:scale-100",
      // A drag that wanders off the row loses the hover, and the duck must not
      // disappear from under the finger still holding it.
      "group-data-[scrubbing]/seek:[&::-webkit-slider-thumb]:scale-100",
      "group-data-[scrubbing]/seek:[&::-moz-range-thumb]:scale-100"
    ),
  },
} as const;

/** m:ss, growing to h:mm:ss only once it has earned the hour. */
function formatTimecode(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const secs = String(total % 60).padStart(2, "0");
  const mins = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours
    ? `${hours}:${String(mins).padStart(2, "0")}:${secs}`
    : `${mins}:${secs}`;
}

function clamp(value: number, lower: number, upper: number) {
  return Math.min(Math.max(value, lower), upper);
}

/**
 * A native range insets the thumb by half its width at both ends, so a plain
 * percentage leaves every layer short of the duck at 0 and past it at 100.
 * Same percentage, corrected back onto the thumb's centre.
 */
function waterline(fraction: number, thumb: number) {
  const offset = ((0.5 - fraction) * thumb).toFixed(2);
  return `calc(${(fraction * 100).toFixed(3)}% + ${offset}px)`;
}

export interface DuckMediaSliderProps
  extends Omit<
    React.ComponentProps<"input">,
    "type" | "value" | "defaultValue" | "onChange"
  > {
  /** Playhead, in the same unit as min/max — seconds, normally. */
  value?: number;
  defaultValue?: number;
  /**
   * How much has loaded, as a fraction of the whole track from 0 to 1 — not a
   * value in min..max, so `buffered.end(buffered.length - 1) / duration` drops
   * straight in. Media with holes in it: pass the range holding the playhead.
   */
  buffered?: number;
  /**
   * Readout that follows the pointer, and the keyboard, before commit. It
   * returns a node rather than a string so a thumbnail can go there.
   */
  preview?: (value: number) => React.ReactNode;
  /** ~4px track, thumb on hover/focus only. For the bottom edge of a video. */
  dense?: boolean;
  /** Every step of a drag or key repeat, while the drag is still in flight. */
  onScrub?: (value: number) => void;
  /** Once, on pointer-up / key-up / blur. This is the one that seeks. */
  onSeek?: (value: number) => void;
  /** Feeds aria-valuetext. A bare number of seconds tells a listener nothing. */
  formatValue?: (value: number) => string;
}

function DuckMediaSlider({
  className,
  value,
  defaultValue = 0,
  min = 0,
  max = 100,
  step = 1,
  buffered = 0,
  preview,
  dense = false,
  onScrub,
  onSeek,
  formatValue = formatTimecode,
  disabled,
  onPointerDown,
  onPointerMove,
  onPointerLeave,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: DuckMediaSliderProps) {
  const controlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue);
  const [scrub, setScrub] = React.useState<number | null>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  /**
   * Handlers read the pending value from the ref, not from state: a keyup can
   * arrive before React has rendered the change event that produced it, and
   * the commit must not lose that last step.
   */
  const pending = React.useRef<number | null>(null);
  const interacting = React.useRef(false);

  const g = dense ? geometry.dense : geometry.default;
  const lower = Number(min);
  const span = Number(max) - lower;
  const toFraction = React.useCallback(
    (input: number) => (span <= 0 ? 0 : clamp((input - lower) / span, 0, 1)),
    [lower, span]
  );

  // The held value wins for as long as it exists. That is the whole story.
  const current = scrub ?? (controlled ? value : internal);
  const played = toFraction(current);

  const hold = React.useCallback((next: number | null) => {
    pending.current = next;
    setScrub(next);
  }, []);

  const commit = React.useCallback(() => {
    interacting.current = false;
    const next = pending.current;
    if (next === null) return;
    hold(null);
    if (!controlled) setInternal(next);
    onSeek?.(next);
  }, [controlled, hold, onSeek]);

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.currentTarget.valueAsNumber;
      hold(next);
      onScrub?.(next);
      // A change with no pointer or key holding it down is a one-shot — a
      // wheel over the track, an assistive click. Nothing will release it.
      if (!interacting.current) commit();
    },
    [commit, hold, onScrub]
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLInputElement>) => {
      onPointerMove?.(event);
      if (!preview || disabled) return;
      const host = event.currentTarget;
      const rect = host.getBoundingClientRect();
      // Reverse of the thumb-centre correction: travel is the track minus one
      // thumb and starts half a thumb in. Direction is read rather than
      // assumed, because a native range in RTL grows leftward.
      const rtl = window.getComputedStyle(host).direction === "rtl";
      const travel = rect.width - g.thumb;
      const from = rtl ? rect.right - event.clientX : event.clientX - rect.left;
      const fraction =
        travel <= 0 ? 0 : clamp((from - g.thumb / 2) / travel, 0, 1);
      const raw = lower + fraction * span;
      const quantum = Number(step);
      setHover(
        Number.isFinite(quantum) && quantum > 0
          ? lower + Math.round((raw - lower) / quantum) * quantum
          : raw
      );
    },
    [disabled, g.thumb, lower, onPointerMove, preview, span, step]
  );

  const hint = scrub ?? hover;

  return (
    <div
      data-slot="duck-media-slider"
      data-dense={dense || undefined}
      data-scrubbing={scrub !== null || undefined}
      className={cn("group/seek relative w-full", className)}
    >
      {preview && hint !== null && (
        <div
          aria-hidden
          style={
            { "--hint": waterline(toFraction(hint), g.thumb) } as React.CSSProperties
          }
          className={cn(
            "pointer-events-none absolute bottom-full z-10 mb-2 start-[var(--hint)]",
            "-translate-x-1/2 rtl:translate-x-1/2",
            // A frame, not a label: the padding is tight enough that a
            // returned <img> reads as a still rather than as bordered text.
            "sticker rounded-lg border-border bg-card px-1.5 py-1",
            "font-mono text-xs tabular-nums text-foreground shadow-[0_2px_8px_oklch(0_0_0/0.35)]",
            "[animation:duck-pop_0.2s_var(--ease-squash)]"
          )}
        >
          {preview(hint)}
        </div>
      )}

      <div className={cn("relative flex w-full items-center", g.row)}>
        {/* Three layers of water, all decoration: the input carries the value. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-secondary",
            g.track
          )}
        />
        {buffered > 0 && (
          <span
            aria-hidden
            style={
              {
                "--buffer": waterline(clamp(buffered, 0, 1), g.thumb),
              } as React.CSSProperties
            }
            className={cn(
              // Dimmer, and behind the played fill: this is the difference
              // between "still loading" and "stalled".
              "pointer-events-none absolute start-0 top-1/2 w-[var(--buffer)] -translate-y-1/2 rounded-full bg-primary/30",
              g.track
            )}
          />
        )}
        <span
          aria-hidden
          style={{ "--fill": waterline(played, g.thumb) } as React.CSSProperties}
          className={cn(
            "pointer-events-none absolute start-0 top-1/2 w-[var(--fill)] -translate-y-1/2 rounded-full bg-primary",
            "group-data-[scrubbing]/seek:duck-glow-primary",
            g.track
          )}
        />

        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={current}
          disabled={disabled}
          aria-valuetext={formatValue(current)}
          onChange={handleChange}
          onPointerDown={(event) => {
            onPointerDown?.(event);
            interacting.current = true;
          }}
          onPointerMove={handlePointerMove}
          onPointerLeave={(event) => {
            onPointerLeave?.(event);
            setHover(null);
          }}
          onPointerUp={(event) => {
            onPointerUp?.(event);
            commit();
          }}
          onPointerCancel={(event) => {
            onPointerCancel?.(event);
            commit();
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            interacting.current = true;
          }}
          onKeyUp={(event) => {
            onKeyUp?.(event);
            commit();
          }}
          onBlur={(event) => {
            onBlur?.(event);
            // The safety net: a pointer released outside the window, or focus
            // leaving mid-drag, must not leave the value held forever.
            commit();
          }}
          className={cn(
            "w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none",
            g.box,
            "[&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent",
            "disabled:cursor-not-allowed disabled:opacity-50",
            // The thumb is the duck: vinyl body, lime edge, same as DuckSlider.
            "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
            "[&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-vinyl",
            "[&::-webkit-slider-thumb]:shadow-[0_1px_3px_oklch(0_0_0/0.35)]",
            "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-200",
            "[&::-webkit-slider-thumb]:ease-[var(--ease-duck)]",
            "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-primary",
            "[&::-moz-range-thumb]:bg-vinyl [&::-moz-range-thumb]:transition-transform",
            // No ring offset: this control sits on a picture, and a
            // background-coloured halo would punch a hole in it.
            "focus-visible:ring-2 focus-visible:ring-ring",
            g.knob
          )}
          {...props}
        />
      </div>
    </div>
  );
}

export { DuckMediaSlider, formatTimecode };
