import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-[calc(var(--radius)-0.75rem)] text-[11px] font-medium whitespace-nowrap transition-[color,background-color,box-shadow,transform] duration-150 outline-none focus-visible:ring-ring/60 focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // The pill itself is drawn by the group's sliding indicator, so an
        // "on" item only changes ink. Giving it a background here as well would
        // mean two things moving for one press.
        segment: "text-muted-foreground data-[state=off]:hover:text-foreground data-[state=on]:text-foreground",
        // Multi-select has no indicator to slide, so these carry their own. The
        // ink is left to the caller: log levels colour theirs by severity.
        mark: "text-muted-foreground data-[state=off]:hover:text-foreground data-[state=on]:bg-chip data-[state=on]:shadow-sm",
      },
      size: {
        // 26px is a mouse target. Every segmented control in the app is one of
        // the most-tapped things on its page -- the range picker, the log
        // levels, the container scope -- so on a phone they grow to 44 and shrink
        // back from `sm` up, where the pointer is precise and the row is tight.
        default: "h-11 px-3 sm:h-[26px] sm:px-2.5",
      },
    },
    defaultVariants: { variant: "segment", size: "default" },
  },
);

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
