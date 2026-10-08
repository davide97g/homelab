import { cn } from "@/lib/utils";

/** The mark: a black tile with the estate drawn on it -- one machine feeding
 *  two. Same tile as autocratico's, so the two apps on the box read as a pair. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg",
        className,
      )}
    >
      <svg viewBox="0 0 32 32" className="size-[62%]" fill="none" stroke="currentColor" strokeLinecap="round">
        <circle cx="8" cy="16" r="3.2" fill="currentColor" stroke="none" />
        <circle cx="24" cy="8.5" r="3.2" fill="currentColor" stroke="none" />
        <circle cx="24" cy="23.5" r="3.2" fill="currentColor" stroke="none" />
        <path d="M11 15C16 13 17.5 10 21 9" strokeWidth="2" />
        <path d="M11 17C16 19 17.5 22 21 23" strokeWidth="2" />
      </svg>
    </span>
  );
}
