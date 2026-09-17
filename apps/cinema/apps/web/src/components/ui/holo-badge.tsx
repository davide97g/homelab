import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const holoBadgeVariants = cva(
  [
    "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5",
    "text-xs font-semibold whitespace-nowrap [&_svg]:size-3",
  ],
  {
    variants: {
      variant: {
        holo: "holo-border text-foreground",
        primary: "bg-primary text-primary-foreground",
        outline: "border-2 border-border text-foreground",
        muted: "bg-muted text-muted-foreground",
        success: "bg-primary/15 text-primary",
        danger: "bg-destructive/15 text-destructive",
      },
    },
    defaultVariants: { variant: "holo" },
  }
);

function HoloBadge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof holoBadgeVariants>) {
  return (
    <span
      data-slot="holo-badge"
      className={cn(holoBadgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { HoloBadge, holoBadgeVariants };
