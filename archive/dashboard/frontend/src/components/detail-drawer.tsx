import { ArrowUpRight, X } from "lucide-react";

import { MiniBar, STATUS_LABEL, StatusDot, TONE_TEXT } from "@/components/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { Snapshot } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The node cards carry the numbers; this carries the lists behind them --
 *  which torrents, which requests, who is watching what. */
export function DetailDrawer({ snapshot, onClose }: { snapshot: Snapshot | null; onClose: () => void }) {
  const open = snapshot != null;

  return (
    <aside
      aria-hidden={!open}
      className={cn(
        "border-border/70 bg-card/95 absolute top-0 right-0 z-20 flex h-full w-[380px] max-w-[88vw] flex-col border-l backdrop-blur-xl transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
    >
      {snapshot && (
        <>
          <header className="flex items-start gap-3 px-4 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <StatusDot status={snapshot.status} />
                <h2 className="truncate text-base font-semibold tracking-tight">{snapshot.name}</h2>
                {snapshot.version && (
                  <Badge variant="muted" className="font-mono text-[10px]">
                    {snapshot.version}
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {snapshot.role} · {STATUS_LABEL[snapshot.status]}
                {snapshot.latencyMs != null ? ` · ${snapshot.latencyMs} ms` : ""}
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close details">
              <X />
            </Button>
          </header>

          <div className="flex gap-2 px-4 pb-3">
            <Button asChild size="sm" className="flex-1">
              <a href={snapshot.link} target="_blank" rel="noreferrer noopener">
                Open {snapshot.name}
                <ArrowUpRight />
              </a>
            </Button>
          </div>

          {snapshot.error && (
            <p className="text-destructive mx-4 mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-[11px] break-words">
              {snapshot.error}
            </p>
          )}

          <Separator />

          <div className="grid grid-cols-2 gap-2 px-4 py-3">
            {snapshot.stats.map((stat) => (
              <div key={stat.label} className="field rounded-md px-2.5 py-2">
                <p className="text-muted-foreground text-[9.5px] font-medium tracking-[0.14em] uppercase">{stat.label}</p>
                <p className={cn("mt-1 font-mono text-sm leading-none font-medium tabular-nums", TONE_TEXT[stat.tone ?? "default"])}>
                  {stat.value}
                </p>
                {stat.hint && <p className="text-muted-foreground mt-1 truncate text-[10px]">{stat.hint}</p>}
              </div>
            ))}
          </div>

          <Separator />

          <div className="flex items-baseline justify-between px-4 py-2.5">
            <h3 className="text-muted-foreground text-[10px] font-medium tracking-[0.14em] uppercase">
              {snapshot.activityLabel ?? "Activity"}
            </h3>
            <span className="text-muted-foreground font-mono text-[10px]">{snapshot.activity?.length ?? 0}</span>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1.5 px-3 pb-6">
              {(snapshot.activity ?? []).length === 0 ? (
                <p className="text-muted-foreground px-1 py-6 text-center text-xs">Nothing right now.</p>
              ) : (
                snapshot.activity!.map((item) => (
                  <div key={item.id} className="border-border/50 bg-muted/25 rounded-lg border px-2.5 py-2">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 truncate text-[12px] leading-snug font-medium" title={item.title}>
                        {item.title}
                      </p>
                      {item.state && (
                        <span className={cn("shrink-0 font-mono text-[9.5px] tracking-wide uppercase", TONE_TEXT[item.tone ?? "default"])}>
                          {item.state}
                        </span>
                      )}
                    </div>
                    {item.subtitle && (
                      <p className="text-muted-foreground mt-0.5 truncate text-[10.5px]" title={item.subtitle}>
                        {item.subtitle}
                      </p>
                    )}
                    {item.progress != null && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <MiniBar value={item.progress} tone={item.tone ?? "accent"} className="flex-1" />
                        <span className="text-muted-foreground shrink-0 font-mono text-[10px] tabular-nums">
                          {Math.round(item.progress * 100)}%
                        </span>
                      </div>
                    )}
                    {item.meta && <p className="text-muted-foreground/70 mt-1 truncate font-mono text-[9.5px]">{item.meta}</p>}
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
