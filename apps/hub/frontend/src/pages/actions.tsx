import type { ActionCatalog, ActionDef, AuditResponse } from "@wire";
import { Info, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ActionButton } from "@/components/actions/action-button";
import { FieldLabel, TONE_TEXT } from "@/components/primitives";
import { usePoll } from "@/hooks/use-poll";
import { fetchActions, fetchAudit } from "@/lib/api";
import { sinceLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const RISK_TONE = { low: "good", medium: "warn", high: "bad" } as const;

const OUTCOME_TONE = { ok: "good", deduped: "accent", denied: "warn", failed: "bad" } as const;

/** Last, deliberately: everything else in the hub is read-only and carries no
 *  risk at all. This page is where that stops being true, so it says what each
 *  action does before it is clicked, what is unavailable and why, and shows the
 *  audit underneath — every attempt, including the refused ones. */
export function ActionsPage() {
  const [catalog, setCatalog] = useState<ActionCatalog | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchActions(controller.signal)
      .then(setCatalog)
      .catch(() => setCatalog(null));
    return () => controller.abort();
  }, []);

  const loadAudit = useCallback((signal: AbortSignal) => fetchAudit(signal), []);
  const { data: audit, refresh } = usePoll<AuditResponse>(loadAudit, 15_000);

  useEffect(() => {
    if (tick > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const containerActions = catalog?.actions.filter((a) => a.target === "container") ?? [];
  const other = catalog?.actions.filter((a) => a.target !== "container") ?? [];

  return (
    <div className="space-y-5">
      <div className="neu text-muted-foreground flex items-start gap-2 p-4 text-[11.5px] leading-relaxed">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          Every attempt below is written to an append-only log, including the ones that are refused — a log of
          successes is a changelog, a log of attempts is an audit. Nothing here can reach a container the deny-list
          covers, and the Dokploy key never leaves the server: only the compose apps allow-listed in the environment
          can be deployed.
        </span>
      </div>

      <section className="space-y-2">
        <FieldLabel>Actions</FieldLabel>
        <div className="grid gap-3 lg:grid-cols-2">
          {other.map((action) => (
            <Card
              key={action.id}
              action={action}
              target={targets[action.id]}
              onTarget={(value) => setTargets((t) => ({ ...t, [action.id]: value }))}
              onDone={() => setTick((n) => n + 1)}
            />
          ))}
        </div>
      </section>

      {containerActions.length > 0 && (
        <div className="neu text-muted-foreground flex items-start gap-2 p-3 text-[11.5px] leading-relaxed">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Container start, stop and restart live on the Containers page, next to the container they act on — a
            list of container names on a separate page is a way to restart the wrong one.
          </span>
        </div>
      )}

      <section className="space-y-2">
        <FieldLabel>Audit</FieldLabel>
        {!audit || audit.entries.length === 0 ? (
          <div className="neu text-muted-foreground p-4 text-sm">Nothing has been attempted yet.</div>
        ) : (
          <div className="neu divide-border divide-y p-1">
            {audit.entries.map((entry, i) => (
              <div key={`${entry.at}-${i}`} className="flex items-start gap-3 px-3 py-2">
                <span className={cn("w-16 shrink-0 text-[11px] font-medium", TONE_TEXT[OUTCOME_TONE[entry.outcome]])}>
                  {entry.outcome}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11.5px]">{entry.action}</span>
                    {entry.target && <span className="text-muted-foreground text-[11px]">{entry.target}</span>}
                  </div>
                  <p className="text-muted-foreground truncate text-[11px]">{entry.message}</p>
                </div>
                <span className="text-muted-foreground tnum shrink-0 text-[11px]" title={entry.at}>
                  {sinceLabel(entry.at)}
                </span>
              </div>
            ))}
          </div>
        )}
        {audit && <p className="text-muted-foreground text-[10.5px]">{audit.path}, on a named volume.</p>}
      </section>
    </div>
  );
}

function Card({
  action,
  target,
  onTarget,
  onDone,
}: {
  action: ActionDef;
  target: string | undefined;
  onTarget: (value: string) => void;
  onDone: () => void;
}) {
  const needsChoice = action.target === "dokploy";
  const chosen = target ?? action.choices?.[0]?.value;

  return (
    <div className={cn("neu flex flex-col gap-3 p-4", !action.available && "opacity-70")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{action.label}</h3>
          <p className="text-muted-foreground mt-0.5 text-[11.5px] leading-relaxed">{action.description}</p>
        </div>
        <span className={cn("shrink-0 text-[10px] font-medium", TONE_TEXT[RISK_TONE[action.risk]])}>
          {action.risk} risk
        </span>
      </div>

      {action.replayable && action.available && (
        <p className="text-muted-foreground text-[10.5px]">
          Not idempotent upstream: a second call does a second thing. A repeated click reuses the same key and is
          answered with what the first one did.
        </p>
      )}

      {action.available ? (
        <div className="flex flex-wrap items-center gap-2">
          {needsChoice && (
            <select
              value={chosen ?? ""}
              onChange={(e) => onTarget(e.target.value)}
              className="border-input bg-card h-8 rounded-[10px] border px-2 text-[12px]"
            >
              {(action.choices ?? []).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          <ActionButton
            action={action.id}
            target={chosen}
            label={action.label}
            confirm={action.confirm}
            variant={action.risk === "high" ? "secondary" : "outline"}
            onDone={onDone}
          />
        </div>
      ) : (
        <p className="text-muted-foreground border-border border-t pt-3 text-[11px]">{action.unavailable}</p>
      )}
    </div>
  );
}
