import type { MediaNode } from "@wire";
import { ArrowUpRight, X } from "lucide-react";
import { FieldLabel, MiniBar, STATUS_LABEL, StatusDot, TONE_TEXT } from "@/components/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** The cards carry the numbers; this carries the lists behind them — which
 *  torrents, which requests, who is watching what. Rendered generically, like
 *  the stats: an `activity` row is a title, a subtitle, a state and a bar, and
 *  no collector gets a branch of its own here. */
export function DetailDrawer({ node, onClose }: { node: MediaNode | null; onClose: () => void }) {
  const open = node !== null;

  return (
    <aside
      aria-hidden={!open}
      aria-label={node ? `${node.label} detail` : undefined}
      className={cn(
        "border-border bg-card/95 absolute inset-y-0 right-0 z-20 flex w-[360px] max-w-[92vw] flex-col border-l backdrop-blur-xl",
        "transition-transform duration-300 ease-out motion-reduce:transition-none",
        open ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
    >
      {node && (
        <>
          <header className="flex items-start gap-3 px-4 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <StatusDot status={node.status} />
                <h2 className="truncate text-base font-semibold">{node.label}</h2>
                {node.version && (
                  <Badge variant="muted" className="font-mono text-[10px]">
                    {node.version}
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {node.role} · {STATUS_LABEL[node.status]}
                {node.latencyMs != null ? ` · ${node.latencyMs} ms` : ""}
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close details">
              <X />
            </Button>
          </header>

          <div className="px-4 pb-3">
            <Button asChild size="sm" className="w-full">
              <a href={node.link} target="_blank" rel="noreferrer noopener">
                Open {node.label}
                <ArrowUpRight />
              </a>
            </Button>
          </div>

          {node.error && (
            <p className="text-tone-bad border-tone-bad/30 bg-tone-bad/10 mx-4 mb-3 rounded-md border px-3 py-2 font-mono text-[11px] break-words">
              {node.error}
            </p>
          )}

          {node.stats.length > 0 && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-2 px-4 py-3">
                {node.stats.map((stat) => (
                  <div key={stat.id} className="neu-inset rounded-md px-2.5 py-2">
                    <FieldLabel>{stat.label}</FieldLabel>
                    <p className={cn("tnum mt-1 text-sm leading-none font-medium", TONE_TEXT[stat.tone ?? "default"])}>
                      {stat.value}
                    </p>
                    {stat.hint && <p className="text-muted-foreground mt-1 truncate text-[10px]">{stat.hint}</p>}
                  </div>
                ))}
              </div>
            </>
          )}

          <Separator />

          <div className="flex items-baseline justify-between px-4 py-2.5">
            <FieldLabel>{node.activityLabel}</FieldLabel>
            <span className="text-muted-foreground tnum text-[10px]">{node.activity.length}</span>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="grid gap-1.5 px-3 pb-6">
              {node.activity.length === 0 ? (
                <p className="text-muted-foreground px-1 py-6 text-center text-xs">Nothing right now.</p>
              ) : (
                node.activity.map((item) => (
                  <div key={item.id} className="neu-inset grid gap-1 rounded-md px-2.5 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12px] font-medium" title={item.title}>
                        {item.title}
                      </span>
                      {item.state && (
                        <span className={cn("shrink-0 text-[10px]", TONE_TEXT[item.tone ?? "default"])}>
                          {item.state}
                        </span>
                      )}
                    </div>
                    {item.subtitle && (
                      <p className="text-muted-foreground truncate text-[10.5px] leading-tight" title={item.subtitle}>
                        {item.subtitle}
                      </p>
                    )}
                    {item.fraction !== undefined && <MiniBar value={item.fraction} tone={item.tone ?? "accent"} />}
                    {item.meta && <p className="text-muted-foreground truncate font-mono text-[10px]">{item.meta}</p>}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </aside>
  );
}
