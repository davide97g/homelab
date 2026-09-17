"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { useHoloPointer } from "@/hooks/use-holo-pointer";

/**
 * StickerCard — the die-cut sticker: thick border, generous radius, soft glow.
 *
 *   holo   iridescent ring instead of the solid border
 *   tilt   the card leans toward the pointer
 *   peel   a corner lifts off the backing on hover
 */
function StickerCard({
  className,
  holo = false,
  tilt = false,
  peel = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  holo?: boolean;
  tilt?: boolean;
  peel?: boolean;
}) {
  const ref = useHoloPointer<HTMLDivElement>({ tilt: 5, disabled: !tilt });

  return (
    <div
      ref={ref}
      data-slot="sticker-card"
      className={cn(
        "group/sticker relative flex flex-col gap-4 rounded-2xl bg-card p-6 text-card-foreground",
        "transition-[box-shadow,border-color] duration-300 ease-[var(--ease-duck)]",
        holo
          ? "holo-border hover:duck-glow"
          : "sticker border-border hover:border-primary/50 hover:duck-glow-primary",
        tilt && "tilt data-[holo=active]:tilt-live",
        peel && "overflow-hidden",
        className
      )}
      {...props}
    >
      {children}
      {peel && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute right-0 bottom-0 size-12 origin-bottom-right scale-0 rounded-br-[inherit]",
            "bg-[linear-gradient(315deg,var(--muted)_42%,var(--border)_50%,var(--background)_58%)]",
            "[clip-path:polygon(100%_0,100%_100%,0_100%)]",
            "shadow-[-6px_-6px_18px_oklch(0_0_0/0.28)]",
            "transition-transform duration-400 ease-[var(--ease-duck)]",
            "group-hover/sticker:scale-100"
          )}
        />
      )}
    </div>
  );
}

function StickerCardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sticker-card-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

function StickerCardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="sticker-card-title"
      className={cn(
        "font-display text-lg leading-none font-bold tracking-tight",
        className
      )}
      {...props}
    />
  );
}

function StickerCardDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="sticker-card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function StickerCardContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div data-slot="sticker-card-content" className={cn(className)} {...props} />
  );
}

function StickerCardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sticker-card-footer"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  );
}

export {
  StickerCard,
  StickerCardHeader,
  StickerCardTitle,
  StickerCardDescription,
  StickerCardContent,
  StickerCardFooter,
};
