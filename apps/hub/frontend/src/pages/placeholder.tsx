import { FieldLabel } from "@/components/primitives";

/** Honest scaffolding. Each of these routes is real and reachable; what is not
 *  built yet says so, and says what it is waiting on, rather than showing an
 *  empty panel that looks broken. */
export function Placeholder({ title, blurb, phase }: { title: string; blurb: string; phase: string }) {
  return (
    <div className="neu mx-auto mt-6 max-w-lg space-y-3 p-6">
      <FieldLabel>Not built yet</FieldLabel>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground text-sm leading-relaxed">{blurb}</p>
      <p className="text-muted-foreground border-border border-t pt-3 text-xs">{phase}</p>
    </div>
  );
}
