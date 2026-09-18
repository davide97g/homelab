import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

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

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("hub-theme", theme);
    } catch {
      // Not remembering the choice is survivable; failing to apply it is not.
    }
  }, [theme]);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
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
  );
}
