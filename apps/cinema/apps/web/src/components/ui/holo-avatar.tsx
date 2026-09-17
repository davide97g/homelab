"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { useHoloPointer } from "@/hooks/use-holo-pointer";

/**
 * HoloAvatar — a die-cut avatar sticker. The foil ring picks up the pointer
 * the way a real holographic sticker picks up a light source.
 */

const avatarVariants = cva(
  "group/avatar relative inline-block shrink-0 select-none align-middle",
  {
    variants: {
      size: {
        xs: "size-7 text-[10px]",
        sm: "size-9 text-xs",
        default: "size-12 text-sm",
        lg: "size-16 text-base",
        xl: "size-24 text-xl",
      },
      shape: {
        circle: "rounded-full",
        sticker: "rounded-[32%] rotate-[-4deg]",
      },
    },
    defaultVariants: { size: "default", shape: "circle" },
  }
);

/** Foil ring thickness per size. */
const foilPad = {
  xs: "p-[2px]",
  sm: "p-[2.5px]",
  default: "p-[3px]",
  lg: "p-[4px]",
  xl: "p-[6px]",
} as const;

/** White vinyl edge thickness per size. */
const edgePad = {
  xs: "p-[1.5px]",
  sm: "p-[2px]",
  default: "p-[2.5px]",
  lg: "p-[3px]",
  xl: "p-[4px]",
} as const;

const statusStyles = {
  online: "bg-primary",
  away: "bg-[oklch(0.85_0.16_72)]",
  offline: "bg-muted-foreground",
} as const;

export interface HoloAvatarProps
  extends Omit<React.ComponentProps<"span">, "children">,
    VariantProps<typeof avatarVariants> {
  src?: string;
  alt?: string;
  /** Initials shown while the image is missing or fails to load. */
  fallback?: string;
  /** foil tracks the pointer, holo is the static gradient, primary is duck lime. */
  ring?: "foil" | "holo" | "primary" | "none";
  status?: keyof typeof statusStyles;
  /** Screen-reader text for the status dot. Defaults to the status name. */
  statusLabel?: string;
}

function HoloAvatar({
  className,
  size = "default",
  shape = "circle",
  src,
  alt = "",
  fallback,
  ring = "foil",
  status,
  statusLabel,
  ...props
}: HoloAvatarProps) {
  const [failed, setFailed] = React.useState(false);
  const holoRef = useHoloPointer<HTMLSpanElement>({
    tilt: 10,
    disabled: ring !== "foil",
  });

  const key = size ?? "default";
  const radius = shape === "sticker" ? "rounded-[32%]" : "rounded-full";
  const showImage = Boolean(src) && !failed;
  const initials = (fallback ?? alt).trim().slice(0, 2).toUpperCase();

  return (
    <span
      ref={holoRef}
      data-slot="holo-avatar"
      className={cn(
        avatarVariants({ size, shape }),
        ring === "foil" && "tilt data-[holo=active]:tilt-live",
        "transition-[filter] duration-300 ease-[var(--ease-duck)]",
        "data-[holo=active]:drop-shadow-[0_6px_20px_oklch(0.78_0.15_195/0.35)]",
        className
      )}
      {...props}
    >
      {/* Layer 1: the foil ring */}
      <span
        className={cn(
          "block size-full",
          radius,
          ring !== "none" && foilPad[key],
          ring === "foil" && "foil",
          ring === "holo" && "bg-[image:var(--holo)] bg-[length:200%_200%]",
          ring === "primary" && "bg-primary",
          ring === "none" && "bg-transparent"
        )}
      >
        {/* Layer 2: the white vinyl edge. Always present, because a die-cut
            sticker has a white border whatever it is stuck to, and because it
            is what keeps stacked avatars readable. */}
        <span
          className={cn(
            "block size-full bg-vinyl ring-1 ring-border",
            radius,
            edgePad[key]
          )}
        >
          {/* Layer 3: the artwork */}
          <span
            className={cn(
              "grid size-full place-items-center overflow-hidden bg-muted font-semibold text-muted-foreground",
              radius
            )}
          >
            {showImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={alt}
                loading="lazy"
                decoding="async"
                onError={() => setFailed(true)}
                className="size-full object-cover transition-transform duration-500 ease-[var(--ease-duck)] group-hover/avatar:scale-105"
              />
            ) : (
              <span aria-hidden={Boolean(alt)}>{initials || "?"}</span>
            )}
          </span>
        </span>
      </span>

      {status && (
        <span
          className={cn(
            "absolute right-0 bottom-0 block rounded-full ring-3 ring-card",
            statusStyles[status],
            key === "xs" || key === "sm" ? "size-2.5" : "size-3.5"
          )}
        >
          <span className="sr-only">{statusLabel ?? status}</span>
        </span>
      )}
    </span>
  );
}

/**
 * HoloAvatarGroup — overlapping stack that fans out on hover, the way a pile
 * of stickers spreads when you slide a finger across it.
 */
function HoloAvatarGroup({
  className,
  children,
  max,
  ...props
}: React.ComponentProps<"div"> & { max?: number }) {
  const items = React.Children.toArray(children);
  const shown = max ? items.slice(0, max) : items;
  const overflow = items.length - shown.length;

  return (
    <div
      data-slot="holo-avatar-group"
      className={cn("group/stack flex items-center", className)}
      {...props}
    >
      {shown.map((child, index) => (
        <div
          key={index}
          className="-ml-2 transition-[margin-left] duration-400 ease-[var(--ease-duck)] first:ml-0 group-hover/stack:ml-1.5 group-hover/stack:first:ml-0"
          style={{ zIndex: shown.length - index }}
        >
          {child}
        </div>
      ))}
      {overflow > 0 && (
        <div className="-ml-2 transition-[margin-left] duration-400 ease-[var(--ease-duck)] group-hover/stack:ml-1.5">
          <HoloAvatar ring="none" fallback={`+${overflow}`} alt={`${overflow} more`} />
        </div>
      )}
    </div>
  );
}

export { HoloAvatar, HoloAvatarGroup, avatarVariants };
