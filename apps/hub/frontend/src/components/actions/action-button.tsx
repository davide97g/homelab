import type { ActionResult } from "@wire";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { runAction } from "@/lib/api";
import { cn } from "@/lib/utils";

/** A two-step button instead of a modal.
 *
 *  The confirmation has to happen somewhere and a dialog is the usual answer,
 *  but a dialog for "restart bazarr" is a lot of ceremony for something you do
 *  from a dashboard, and ceremony you perform forty times stops being read. Arm,
 *  then fire, with the armed state timing itself out — the second click is a
 *  deliberate act and an accidental first one costs four seconds.
 *
 *  The idempotency key is generated when the intent forms, not when the request
 *  goes out, and it is reused for a retry. That is what makes a double-click, a
 *  tunnel replay and a retry-after-timeout the same thing to the server. */
const ARMED_MS = 4000;

export function ActionButton({
  action,
  target,
  label,
  confirm,
  disabled,
  title,
  variant = "outline",
  size = "sm",
  onDone,
  className,
  buttonClassName,
}: {
  action: string;
  target?: string;
  label: string;
  confirm: boolean;
  disabled?: boolean;
  title?: string;
  variant?: "outline" | "ghost" | "secondary" | "destructive";
  size?: "sm" | "default";
  /** Extra classes for the button itself rather than the wrapper, which is what
   *  the containers list needs to grow a 32px row control to a 44px thumb one. */
  buttonClassName?: string;
  onDone?: (result: ActionResult) => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const key = useRef<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(id);
  }, [armed]);

  useEffect(() => {
    if (!result) return;
    const id = setTimeout(() => setResult(null), 6000);
    return () => clearTimeout(id);
  }, [result]);

  async function fire() {
    key.current ??= crypto.randomUUID();
    setPending(true);
    setArmed(false);
    try {
      const res = await runAction({ action, target, key: key.current, confirm: true });
      setResult(res);
      onDone?.(res);
      // A settled intent gets a new key next time; a failed one keeps its key so
      // an immediate retry is the same attempt rather than a second one.
      if (res.ok) key.current = null;
    } catch (err) {
      setResult({
        ok: false,
        action,
        outcome: "failed",
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      });
    } finally {
      setPending(false);
    }
  }

  const showing = result;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Button
        type="button"
        size={size}
        className={buttonClassName}
        variant={armed ? "destructive" : variant}
        disabled={disabled || pending}
        title={title}
        onClick={() => (confirm && !armed ? setArmed(true) : void fire())}
      >
        {pending && <Loader2 className="size-3.5 animate-spin" />}
        {armed ? "confirm?" : label}
      </Button>

      {showing && (
        <span
          className={cn(
            "flex items-center gap-1 text-[11px]",
            showing.ok ? "text-tone-good" : "text-tone-bad",
          )}
          title={showing.message}
        >
          {showing.ok ? <Check className="animate-in zoom-in-50 duration-200 size-3.5" /> : <TriangleAlert className="animate-in zoom-in-50 duration-200 size-3.5" />}
          <span className="max-w-56 truncate">{showing.message}</span>
        </span>
      )}
    </span>
  );
}
