import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * StickerSkeleton — the un-inked sticker. The shape is already die-cut and
 * sitting on the sheet; the art just has not printed yet.
 *
 * Every skeleton shares one wave. Twelve of them each running their own
 * shimmer reads as twelve things loading; staggering them off a single ramp
 * reads as one page arriving, which is what is actually happening.
 *
 * Under reduced motion the global rule collapses the sweep and what is left is
 * a plain muted block — still a correct skeleton, just a still one.
 */

const shapes = {
  line: "h-4 w-full rounded-md",
  title: "h-6 w-2/3 rounded-md",
  circle: "size-10 rounded-full",
  card: "h-32 w-full rounded-2xl",
  // Artwork placeholders take their height from the ratio, so a grid of them
  // does not need a height at every call site — and does not need the call site
  // to remember to cancel one either.
  poster: "aspect-[2/3] w-full rounded-2xl",
  video: "aspect-video w-full rounded-2xl",
} as const;

export interface StickerSkeletonProps extends React.ComponentProps<"div"> {
  shape?: keyof typeof shapes;
  /** Position in the shared wave. Later items sweep later. */
  delay?: number;
}

function StickerSkeleton({
  className,
  shape = "line",
  delay = 0,
  style,
  ...props
}: StickerSkeletonProps) {
  return (
    <div
      data-slot="sticker-skeleton"
      aria-hidden
      style={{ animationDelay: delay ? `${delay}ms` : undefined, ...style }}
      className={cn(
        "bg-muted",
        // --border, not --secondary: secondary sits 0.01 of lightness away from
        // muted in both themes, so the sweep would technically run and be
        // invisible. --border clears it in dark and in light.
        "bg-[linear-gradient(105deg,transparent_38%,var(--border)_48%,transparent_58%)] bg-[length:280%_100%]",
        "[animation:duck-shimmer_1.6s_ease-in-out_infinite]",
        shapes[shape],
        className
      )}
      {...props}
    />
  );
}

/**
 * A paragraph of un-inked lines. The last one is short, the way the last line
 * of real text is, and each line joins the wave 90ms after the one above.
 */
function StickerSkeletonText({
  className,
  lines = 3,
  ...props
}: React.ComponentProps<"div"> & { lines?: number }) {
  return (
    <div
      data-slot="sticker-skeleton-text"
      role="status"
      aria-busy
      aria-label="Loading"
      className={cn("flex w-full flex-col gap-2", className)}
      {...props}
    >
      {Array.from({ length: lines }, (_, index) => (
        <StickerSkeleton
          key={index}
          delay={index * 90}
          className={index === lines - 1 ? "w-3/5" : undefined}
        />
      ))}
    </div>
  );
}

export { StickerSkeleton, StickerSkeletonText };
