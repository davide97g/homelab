import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

/** Same key and same fallback as the boot script in index.html, which has
 *  already put the class on <html> by the time this runs. */
function initial(): Theme {
  try {
    const saved = localStorage.getItem("hub-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Private windows and blocked site data both throw here. A remembered theme
    // is a convenience, so fall through to the system preference.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Applies the change with the new theme spreading as a circle from the button
 *  (View Transitions). Without the API, or with reduced motion, it just applies
 *  it. `apply` puts the class on <html> itself so the snapshot is taken on the
 *  new look rather than a frame before React gets there. */
function reveal(apply: () => void, origin: { x: number; y: number }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduced) {
    apply();
    return;
  }
  const { x, y } = origin;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const transition = document.startViewTransition(apply);
  void transition.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)", pseudoElement: "::view-transition-new(root)" },
    );
  });
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("hub-theme", theme);
    } catch {
      // Not remembering the choice is survivable; failing to apply it is not.
    }
  }, [theme]);

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const box = e.currentTarget.getBoundingClientRect();
    reveal(
      () => {
        document.documentElement.classList.toggle("dark", next === "dark");
        flushSync(() => setTheme(next));
      },
      { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    );
  }

  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-lg" className={className} aria-label={label} onClick={toggle}>
          {/* Both are mounted and stacked, so the swap is a crossfade rather than
              one icon disappearing and another arriving in its place. */}
          <span className="relative grid size-4 place-items-center">
            <Sun
              className={cn(
                "absolute size-4 transition-[opacity,transform] duration-200",
                theme === "dark" ? "scale-100 rotate-0 opacity-100" : "scale-75 -rotate-90 opacity-0",
              )}
            />
            <Moon
              className={cn(
                "absolute size-4 transition-[opacity,transform] duration-200",
                theme === "dark" ? "scale-75 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100",
              )}
            />
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
