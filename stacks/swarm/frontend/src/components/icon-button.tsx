import type { ComponentType } from "react";

export function IconButton({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid size-9 place-items-center rounded-lg bg-surface-2 text-muted
        transition-colors duration-[var(--dur-fast)]
        hover:bg-surface-3 ${danger ? "hover:text-danger" : "hover:text-foreground"}`}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}
