import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

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
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
