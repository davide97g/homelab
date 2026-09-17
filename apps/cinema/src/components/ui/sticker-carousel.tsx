"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * StickerCarousel — a strip of stickers peeled off the roll sideways. The
 * track is a plain scroll-snap container, so a flick, a trackpad, a scrollbar
 * drag and a screen reader's own scrolling all keep working; the arrows exist
 * only to give a mouse the same reach as a thumb.
 *
 * The rule is no dead controls. The arrows are not rendered at all while the
 * whole strip fits, each one greys out the moment there is nothing left on
 * that side, and the fade only paints the edge that is actually hiding
 * something — so the chrome always reports the real scroll position instead
 * of decorating the frame.
 *
 * Direct children are the slides. The track pins them to `shrink-0` and
 * `snap-start`, so all a slide has to bring is a width.
 */

const gaps = {
  sm: "gap-2",
  default: "gap-4",
  lg: "gap-6",
} as const;

/**
 * scrollLeft counts up to the right in LTR and down into the negatives in
 * RTL, so reads go through Math.abs and writes go through this sign. The old
 * WebKit behaviour, where RTL started at scrollWidth, is not handled.
 */
function directionSign(track: HTMLElement) {
  return getComputedStyle(track).direction === "rtl" ? -1 : 1;
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

export interface StickerCarouselProps
  extends Omit<React.ComponentProps<"div">, "title"> {
  /** Heading above the track. */
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Extra content in the heading row, for example a "See all" link. */
  actions?: React.ReactNode;
  /** Accessible name for the track. Falls back to `title` when it is a string. */
  label?: string;
  /** Arrows over the track edges, in the heading row, or not at all. */
  controls?: "edge" | "header" | "none";
  gap?: keyof typeof gaps;
  /** Pad the track so slides peek in from the edge instead of touching it. */
  peek?: boolean;
  /** Share of the visible width one arrow press or key travels. */
  page?: number;
  /** Fade the edge that still has content behind it. */
  fade?: boolean;
}

function StickerCarousel({
  className,
  title,
  description,
  actions,
  label,
  controls = "edge",
  gap = "default",
  peek = false,
  page = 0.85,
  fade = true,
  children,
  ...props
}: StickerCarouselProps) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [focusRing, setFocusRing] = React.useState(false);
  const [scroll, setScroll] = React.useState({
    start: false,
    end: false,
    overflow: false,
    rtl: false,
  });

  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const measure = () => {
      const max = track.scrollWidth - track.clientWidth;
      const travelled = Math.abs(track.scrollLeft);
      const next = {
        start: travelled > 1,
        end: travelled < max - 1,
        overflow: max > 1,
        rtl: directionSign(track) < 0,
      };
      setScroll((prev) =>
        prev.start === next.start &&
        prev.end === next.end &&
        prev.overflow === next.overflow &&
        prev.rtl === next.rtl
          ? prev
          : next
      );
    };

    measure();
    track.addEventListener("scroll", measure, { passive: true });
    // Slides change size without the track doing so — artwork finishing its
    // load is the usual case — so each one is watched as well.
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    for (const slide of Array.from(track.children)) observer.observe(slide);

    return () => {
      track.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [children]);

  /** direction is logical: 1 travels toward the end of the strip. */
  const scrollPage = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({
      left: direction * directionSign(track) * track.clientWidth * page,
      behavior: scrollBehavior(),
    });
  };

  const scrollToEdge = (edge: "start" | "end") => {
    const track = trackRef.current;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    track.scrollTo({
      left: edge === "start" ? 0 : max * directionSign(track),
      behavior: scrollBehavior(),
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Keys pressed inside a slide belong to whatever is focused there.
    if (event.target !== event.currentTarget) return;
    const toRight: 1 | -1 = scroll.rtl ? -1 : 1;

    switch (event.key) {
      case "ArrowRight":
        scrollPage(toRight);
        break;
      case "ArrowLeft":
        scrollPage(toRight === 1 ? -1 : 1);
        break;
      case "PageDown":
        scrollPage(1);
        break;
      case "PageUp":
        scrollPage(-1);
        break;
      case "Home":
        scrollToEdge("start");
        break;
      case "End":
        scrollToEdge("end");
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const control = (direction: 1 | -1) => {
    const next = direction === 1;
    // The chevron points at the physical side it moves toward, so it mirrors.
    const pointsRight = scroll.rtl ? !next : next;
    const Icon = pointsRight ? ChevronRight : ChevronLeft;

    return (
      <button
        type="button"
        data-slot="sticker-carousel-control"
        data-direction={next ? "next" : "prev"}
        aria-label={next ? "Next" : "Previous"}
        disabled={next ? !scroll.end : !scroll.start}
        onClick={() => scrollPage(direction)}
        className={cn(
          "sticker grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border-border bg-card",
          "transition-[box-shadow,border-color,opacity] duration-300 ease-[var(--ease-duck)]",
          "hover:border-primary/50 hover:duck-glow-primary",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-40",
          controls === "edge" && "absolute top-1/2 z-1 -translate-y-1/2",
          controls === "edge" && (next ? "end-2" : "start-2")
        )}
      >
        <Icon aria-hidden className="size-4" />
      </button>
    );
  };

  const fadeStart = scroll.start ? "2.5rem" : "0px";
  const fadeEnd = scroll.end ? "2.5rem" : "0px";
  const [fadeLeft, fadeRight] = scroll.rtl
    ? [fadeEnd, fadeStart]
    : [fadeStart, fadeEnd];

  const arrows = scroll.overflow && controls !== "none";
  const header = title || description || actions || (arrows && controls === "header");

  return (
    <div
      data-slot="sticker-carousel"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    >
      {header && (
        <div
          data-slot="sticker-carousel-header"
          className="flex items-end justify-between gap-4"
        >
          <div className="flex flex-col gap-1.5">
            {title && (
              <h3 className="font-display text-lg leading-none font-bold tracking-tight">
                {title}
              </h3>
            )}
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {(actions || (arrows && controls === "header")) && (
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              {arrows && controls === "header" && (
                <>
                  {control(-1)}
                  {control(1)}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* The ring lives out here: the track's mask would eat its own. */}
      <div
        data-slot="sticker-carousel-viewport"
        data-focused={focusRing || undefined}
        className={cn(
          "relative rounded-2xl",
          "data-[focused]:ring-2 data-[focused]:ring-ring data-[focused]:ring-offset-2 data-[focused]:ring-offset-background"
        )}
      >
        <div
          ref={trackRef}
          data-slot="sticker-carousel-track"
          role="group"
          aria-roledescription="carousel"
          aria-label={label ?? (typeof title === "string" ? title : undefined)}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={(event) =>
            setFocusRing(event.currentTarget.matches(":focus-visible"))
          }
          onBlur={() => setFocusRing(false)}
          style={
            fade && scroll.overflow
              ? {
                  maskImage: `linear-gradient(to right, transparent, #000 ${fadeLeft}, #000 calc(100% - ${fadeRight}), transparent)`,
                }
              : undefined
          }
          className={cn(
            // py-2 is glow room: overflow-x also clips vertically.
            "flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain py-2",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "focus-visible:outline-none",
            "[&>*]:shrink-0 [&>*]:snap-start",
            gaps[gap],
            peek && "scroll-px-4 px-4"
          )}
        >
          {children}
        </div>
        {arrows && controls === "edge" && (
          <>
            {control(-1)}
            {control(1)}
          </>
        )}
      </div>
    </div>
  );
}

export { StickerCarousel };
