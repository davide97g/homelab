import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground/70 selection:bg-primary selection:text-primary-foreground border-input flex h-10 w-full min-w-0 rounded-md border bg-input/30 px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/30 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
