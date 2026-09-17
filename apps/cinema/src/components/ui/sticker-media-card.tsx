"use client";

import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";
import { StickerProgressTrack } from "@/components/ui/sticker-progress";

/**
 * StickerMediaCard — the poster, not the sleeve. The artwork fills a die-cut
 * frame edge to edge with nothing printed on top of it, and the caption sits
 * outside the frame, on the backing. The sticker vocabulary underneath is
 * unchanged: thick border, rounded-2xl, lime edge and duck-glow-primary on
 * hover, one step of lift, and the art pushing gently against the cut line
 * as it scales.
 *
 * The tile is exactly one focusable link. A wall of posters is navigated by
 * tabbing, so a play button or a favourite toggle inside the frame would
 * double every tab stop and bury the real target: the overlay takes no
 * pointer events, and the progress bar is a readout, never a scrubber.
 */

export interface StickerMediaCardProps
  extends Omit<React.ComponentProps<"a">, "title" | "children"> {
  src?: string;
  alt?: string;
  /** Frame ratio. A number is width / height. */
  aspect?: "2/3" | "16/9" | "1/1" | number;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Centred decoration that fades in on hover and focus, such as a play badge. */
  overlay?: React.ReactNode;
  /** 0 to 100. Draws the thin bar along the bottom edge of the artwork. */
  progress?: number;
  /** Shown when src is missing or the image fails to load. Defaults to alt. */
  fallback?: string;
  /** Render a router Link as the tile. Pass exactly one element child. */
  asChild?: boolean;
  children?: React.ReactNode;
}

function StickerMediaCard({
  className,
  src,
  alt = "",
  aspect = "2/3",
  title,
  subtitle,
  overlay,
  progress,
  fallback,
  asChild = false,
  children,
  ...props
}: StickerMediaCardProps) {
  // Keyed by src rather than a bare boolean, so swapping the poster on a
  // recycled tile retries the image instead of staying stuck on the fallback.
  const [failed, setFailed] = React.useState<string>();
  const showImage = Boolean(src) && failed !== src;

  // The caption already carries the title as real text, so the artwork is
  // decorative whenever there is one. Without a caption, alt is the only
  // accessible name the link has.
  const named = Boolean(title);

  const Comp = asChild ? Slot : "a";

  return (
    <Comp
      data-slot="sticker-media-card"
      className={cn(
        "group/media flex flex-col gap-2 rounded-2xl outline-none",
        "transform-gpu transition-transform duration-300 ease-[var(--ease-duck)]",
        "hover:-translate-y-1 focus-visible:-translate-y-1",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background",
        className
      )}
      {...props}
    >
      {/* Slot appends what follows the Slottable to the cloned child, so the
          frame lands inside the consumer's <Link> rather than beside it. */}
      {asChild && <Slottable>{children}</Slottable>}

      <div
        data-slot="sticker-media-card-frame"
        // The ratio is a runtime value, so it cannot be a compiled utility.
        style={{ aspectRatio: String(aspect) }}
        className={cn(
          "sticker relative w-full overflow-hidden rounded-2xl border-border bg-muted",
          "transition-[box-shadow,border-color] duration-300 ease-[var(--ease-duck)]",
          "group-hover/media:border-primary group-hover/media:duck-glow-primary",
          "group-focus-visible/media:border-primary group-focus-visible/media:duck-glow-primary"
        )}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            data-slot="sticker-media-card-image"
            src={src}
            alt={named ? "" : alt}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(src)}
            className="size-full object-cover transition-transform duration-500 ease-[var(--ease-duck)] group-hover/media:scale-[1.06] group-focus-visible/media:scale-[1.06]"
          />
        ) : (
          <span
            data-slot="sticker-media-card-fallback"
            aria-hidden={named || undefined}
            className="grid size-full place-items-center bg-[linear-gradient(145deg,var(--secondary),var(--muted))] p-3 text-center font-display text-sm leading-tight font-bold text-muted-foreground"
          >
            {fallback ?? alt}
          </span>
        )}

        {overlay && (
          <span
            data-slot="sticker-media-card-overlay"
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 grid place-items-center bg-[oklch(0_0_0/0.35)]",
              "opacity-0 transition-opacity duration-300 ease-[var(--ease-duck)]",
              "group-hover/media:opacity-100 group-focus-visible/media:opacity-100"
            )}
          >
            {overlay}
          </span>
        )}

        {progress !== undefined && (
          // Square, because the bar runs into the frame's own corners: a pill
          // floating inside them would read as a second, smaller object.
          //
          // aria-hidden because the track is a live progressbar and this whole
          // tile is one link: its aria-valuenow would otherwise be read into
          // the link's name, announcing "link 54.1842 Carnival in Costa Rica".
          // If how far in matters, put it in the name — aria-label="Carnival
          // in Costa Rica, 54% watched" — not in a nested widget.
          <StickerProgressTrack
            aria-hidden
            value={progress}
            size="sm"
            className="absolute inset-x-0 bottom-0 rounded-none"
          />
        )}
      </div>

      {(title || subtitle) && (
        <div
          data-slot="sticker-media-card-caption"
          className="flex flex-col gap-0.5 px-0.5"
        >
          {title && (
            <span
              data-slot="sticker-media-card-title"
              className="truncate font-display text-sm leading-snug font-bold tracking-tight transition-colors duration-300 ease-[var(--ease-duck)] group-hover/media:text-primary group-focus-visible/media:text-primary"
            >
              {title}
            </span>
          )}
          {subtitle && (
            <span
              data-slot="sticker-media-card-subtitle"
              className="truncate text-xs text-muted-foreground"
            >
              {subtitle}
            </span>
          )}
        </div>
      )}
    </Comp>
  );
}

export { StickerMediaCard };
