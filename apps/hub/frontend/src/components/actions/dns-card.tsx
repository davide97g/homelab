import type { DnsSnapshot } from "@wire";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect } from "react";
import { FieldLabel, StatusDot, TONE_TEXT } from "@/components/primitives";
import { usePoll } from "@/hooks/use-poll";
import { fetchDns } from "@/lib/api";
import { sinceLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Where the house's DNS goes right now, and what the hub will do about it.
 *  Sits on the Actions page because the one thing to do about it from here is
 *  the Bypass action below; the way back is in the FRITZ!Box, with its button. */
export function DnsCard({ tick }: { tick: number }) {
  const load = useCallback((signal: AbortSignal) => fetchDns(signal), []);
  const { data, error, refresh } = usePoll<DnsSnapshot>(load, 15_000);

  // An action just ran -- most likely Bypass -- so read the FRITZ!Box again now
  // rather than on the next poll.
  useEffect(() => {
    if (tick > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  if (!data) {
    return (
      <section className="space-y-2">
        <FieldLabel>DNS</FieldLabel>
        <div className="neu text-muted-foreground p-4 text-sm">{error ?? "Reading the DNS path…"}</div>
      </section>
    );
  }

  const { adguard, fritz, bypass } = data;
  const filtered = adguard.ok !== false && fritz.mode === "custom";
  const status = adguard.ok === false ? "down" : fritz.mode === "custom" ? "up" : "warn";

  return (
    <section className="space-y-2">
      <FieldLabel>DNS</FieldLabel>
      <div className="neu space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <StatusDot status={status} />
            <h3 className="text-sm font-semibold">
              {filtered ? "Ad blocking on" : fritz.mode === "provider" ? "AdGuard bypassed" : "AdGuard not answering"}
            </h3>
          </div>
          <div className="flex shrink-0 gap-3 text-[11px]">
            <a href={data.links.adguard} target="_blank" rel="noreferrer" className="text-tone-accent inline-flex items-center gap-1">
              AdGuard <ExternalLink className="size-3" />
            </a>
            <a href={data.links.fritz} target="_blank" rel="noreferrer" className="text-tone-accent inline-flex items-center gap-1">
              FRITZ!Box <ExternalLink className="size-3" />
            </a>
          </div>
        </div>

        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-[11.5px]">
          <dt className="text-muted-foreground">AdGuard</dt>
          <dd className={cn(adguard.ok === false && TONE_TEXT.bad)}>
            {adguard.detail}
            {adguard.failingSince && <> · failing {sinceLabel(adguard.failingSince)}</>}
          </dd>
          <dt className="text-muted-foreground">FRITZ!Box</dt>
          <dd className={cn(fritz.mode === "provider" && TONE_TEXT.warn, fritz.mode === "unknown" && TONE_TEXT.bad)}>
            {fritz.mode === "custom"
              ? `forwards to ${fritz.servers.join(", ")}`
              : fritz.mode === "provider"
                ? "uses the provider's DNS"
                : `unreadable: ${fritz.error ?? "unknown"}`}
          </dd>
          <dt className="text-muted-foreground">Failover</dt>
          <dd>
            {data.auto
              ? `automatic: after ${data.afterSeconds} s of silence the FRITZ!Box goes to the provider`
              : "off — set FRITZ_USER and FRITZ_PASS (and DNS_FAILOVER not off)"}
          </dd>
        </dl>

        {bypass && (
          <p className={cn("text-[11.5px] leading-relaxed", TONE_TEXT.warn)}>
            {bypass.by === "auto" ? "Switched by the hub" : "Bypassed by hand"} {sinceLabel(bypass.at)}: {bypass.reason}.
          </p>
        )}
        {fritz.mode === "provider" && (
          <p className="text-muted-foreground border-border border-t pt-3 text-[11px] leading-relaxed">
            To switch back once AdGuard answers: FRITZ!Box › Internet › Account Information › DNS Server › Use other
            DNSv4 servers (already filled in) › Apply, then press the button on the box. The hub cannot do this part:
            the FRITZ!Box asks for its confirmation on that change.
          </p>
        )}
        {data.note && <p className={cn("text-[11px]", TONE_TEXT.warn)}>{data.note}</p>}
      </div>
    </section>
  );
}
