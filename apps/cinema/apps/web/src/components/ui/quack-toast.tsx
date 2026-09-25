"use client";

import * as React from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { DuckGlyph } from "@/components/ui/duck-spinner";

/**
 * QuackToast — transient messages that slide in from the corner. The queue is
 * capped so a burst of events never buries the page.
 *
 *   const { toast, quack } = useQuackToast()
 *   toast({ title: "Theme installed", variant: "success" })
 */

export type ToastVariant = "default" | "success" | "error" | "quack";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Mark for the quack variant. Any image URL; defaults to the duck/ui logo. */
  markSrc?: string;
  /** Milliseconds before auto-dismiss. Defaults to 4000. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastApi {
  toast: (options: ToastOptions) => void;
  quack: () => void;
  dismiss: (id: number) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

export function useQuackToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useQuackToast must be used inside <QuackToastProvider>");
  }
  return context;
}

const variantStyles: Record<ToastVariant, string> = {
  default: "border-border",
  success: "border-primary/60",
  error: "border-destructive/60",
  quack: "holo-border",
};

function VariantIcon({
  variant,
  markSrc,
}: {
  variant: ToastVariant;
  markSrc?: string;
}) {
  if (variant === "success")
    return <CheckCircle2 className="size-4 text-primary" />;
  if (variant === "error")
    return <TriangleAlert className="size-4 text-destructive" />;
  if (variant === "quack")
    return <DuckGlyph src={markSrc} className="size-5 -m-0.5" />;
  return <Info className="size-4 text-muted-foreground" />;
}

function QuackToastProvider({
  children,
  max = 3,
}: {
  children: React.ReactNode;
  /** Most toasts on screen at once. Older ones drop off the top. */
  max?: number;
}) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const nextId = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = React.useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...options, id }].slice(-max));
      window.setTimeout(() => dismiss(id), options.duration ?? 4000);
    },
    [dismiss, max]
  );

  const quack = React.useCallback(
    () => toast({ title: "Quack.", variant: "quack", duration: 2000 }),
    [toast]
  );

  const api = React.useMemo(
    () => ({ toast, quack, dismiss }),
    [toast, quack, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            aria-live="polite"
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-xl border-2 bg-popover p-3 text-popover-foreground shadow-lg",
              "[animation:duck-rise_0.3s_var(--ease-duck)]",
              variantStyles[item.variant ?? "default"]
            )}
          >
            <span className="mt-0.5 shrink-0">
              <VariantIcon
                variant={item.variant ?? "default"}
                markSrc={item.markSrc}
              />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold">{item.title}</p>
              {item.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss"
              className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export { QuackToastProvider };
