import { LayoutGrid, ListChecks, SlidersHorizontal } from "lucide-react";

export type View = "dashboard" | "transfers" | "settings";

const ITEMS: { key: View; label: string; icon: typeof LayoutGrid }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { key: "transfers", label: "Transfers", icon: ListChecks },
  { key: "settings", label: "Settings", icon: SlidersHorizontal },
];

export function Rail({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <nav
      aria-label="Sections"
      className="sticky top-0 flex h-dvh w-[84px] shrink-0 flex-col items-center gap-1 py-6"
    >
      {ITEMS.map(({ key, label, icon: Icon }) => {
        const active = view === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-current={active ? "page" : undefined}
            className={`relative flex w-[68px] flex-col items-center gap-1.5 rounded-xl py-3
              transition-colors duration-[var(--dur-fast)] ${
                active ? "bg-surface text-foreground" : "text-muted hover:text-foreground"
              }`}
          >
            {/* The active marker is the only place the accent appears in the rail. */}
            {active ? (
              <span className="absolute top-1/2 left-0 h-6 w-[2px] -translate-y-1/2 rounded-full bg-accent" />
            ) : null}
            <Icon size={18} strokeWidth={2} />
            <span className="text-[11px]">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
