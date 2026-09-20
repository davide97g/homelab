import { Pin, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AskResult } from "@/components/ask/result";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/primitives";
import { pinned, unpin, type Pinned } from "@/lib/pinned";

/** The board of kept answers.
 *
 *  Every card here is a question someone asked once and wanted back. They are
 *  live, not snapshots: the spec is re-queried on each visit, so a chart pinned
 *  a week ago shows this week's numbers. That is the whole reason a pin is a
 *  spec rather than an image. */
export function AskPage() {
  // The composer lives in the shell, above the router. Rather than thread a
  // callback through PAGES -- whose signature every other page shares -- this
  // asks for it by event, the same way lib/activity.ts drives the refresh.
  const onAsk = () => window.dispatchEvent(new Event("hub:ask"));
  const [items, setItems] = useState<Pinned[]>(pinned);

  // The composer writes to localStorage from the same tab, so the storage event
  // never fires here -- it only crosses tabs. pinned.ts dispatches its own.
  useEffect(() => {
    const refresh = () => setItems(pinned());
    window.addEventListener("hub:pinned", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("hub:pinned", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (items.length === 0) {
    return (
      <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 text-center">
        <Sparkles className="text-muted-foreground size-6" />
        <h1 className="text-sm font-semibold">Nothing pinned yet</h1>
        <p className="text-muted-foreground text-[12px] leading-relaxed">
          Ask for a chart and pin the ones worth keeping. They live in this browser, and they
          re-query every time you open this page.
        </p>
        <Button size="sm" onClick={onAsk} className="mt-1">
          <Sparkles className="size-3.5" />
          Ask something
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>
          {items.length} pinned {items.length === 1 ? "answer" : "answers"}
        </FieldLabel>
        <Button size="sm" variant="outline" onClick={onAsk}>
          <Sparkles className="size-3.5" />
          Ask
        </Button>
      </div>

      {items.map((item) => (
        <section key={item.at} className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Pin className="text-muted-foreground size-3" />
                <span className="truncate">{item.prompt}</span>
              </h2>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                pinned {new Date(item.at).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove this pin"
              onClick={() => {
                unpin(item.at);
                setItems(pinned());
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
          <AskResult spec={item.spec} />
        </section>
      ))}
    </div>
  );
}
