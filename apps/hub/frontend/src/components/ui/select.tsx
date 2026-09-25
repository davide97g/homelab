import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "group border-input bg-card flex h-8 w-fit items-center justify-between gap-2 rounded-[10px] border px-2 text-[12px] whitespace-nowrap transition-[color,box-shadow,transform] duration-150 outline-none",
        "focus-visible:ring-ring/60 focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        "data-[placeholder]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        {/* Rotates to point at the open list rather than swapping for a
            different glyph. */}
        <ChevronDownIcon className="text-muted-foreground size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          "bg-popover text-popover-foreground relative z-50 max-h-(--radix-select-content-available-height) min-w-32 overflow-hidden rounded-[10px] border shadow-lg",
          // Enters from the side it opens on, so the list reads as coming out of
          // the trigger rather than appearing next to it.
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
          "data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1",
          position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn("p-1", position === "popper" && "w-full min-w-(--radix-select-trigger-width) scroll-my-1")}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-[7px] py-1.5 pr-7 pl-2 text-[12px] outline-none select-none",
        "transition-colors duration-100 focus:bg-muted focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="text-primary animate-in zoom-in-75 size-3.5 duration-150" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectScrollUpButton(props: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className="flex cursor-default items-center justify-center py-1"
      {...props}
    >
      <ChevronUpIcon className="size-3.5" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton(props: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className="flex cursor-default items-center justify-center py-1"
      {...props}
    >
      <ChevronDownIcon className="size-3.5" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
