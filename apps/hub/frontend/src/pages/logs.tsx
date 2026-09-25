import type { LogLevel, LogOptions, LogRange } from "@wire";
import { ArrowUpRight, Pause, Play, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { LogView } from "@/components/logs/log-view";
import { FieldLabel, Segmented, Toggles } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLogs, type LogFilters } from "@/hooks/use-logs";
import { fetchLogOptions } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Both lists are typed against the wire unions, so a value that exists here and
 *  not on the server fails to compile rather than to fetch. */
const RANGES: LogRange[] = ["5m", "15m", "1h", "6h", "24h", "7d"];
const LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];

const LEVEL_TONE = { error: "bad", warn: "warn", info: "accent", debug: "default" } as const;

/** The "no host filter" option. Not "", which Radix's Select treats as a
 *  request to clear the value entirely. */
const BOTH_HOSTS = "__any";

/** The thing that was missing entirely until this week: the stack had metrics
 *  and no logs, so "why did the temperature spike at 03:12" could only ever be
 *  answered with a shrug.
 *
 *  Everything the browser sends is a structured filter. The LogQL is assembled
 *  on the server and printed back here, so what was asked is visible and the
 *  Grafana link next to it opens the same query in the tool built for it. */
export function LogsPage() {
  const [options, setOptions] = useState<LogOptions | null>(null);
  const [live, setLive] = useState(true);
  // Six filters is a reasonable strip on a desktop and most of a phone screen
  // before a single line of log. Host, level and window are the three anyone
  // reaches for; the three text fields fold behind a disclosure below `sm` and
  // are always present from `sm` up.
  const [moreFilters, setMoreFilters] = useState(false);
  const [contains, setContains] = useState("");
  const [filters, setFilters] = useState<LogFilters>({
    range: "1h",
    host: null,
    container: null,
    unit: null,
    levels: [],
    contains: "",
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchLogOptions(controller.signal)
      .then(setOptions)
      .catch(() => setOptions(null));
    return () => controller.abort();
  }, []);

  // Typing is not a query. Each keystroke would otherwise be a new window, a new
  // cursor and a Loki read of everything matched so far.
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.contains === contains ? f : { ...f, contains })), 350);
    return () => clearTimeout(id);
  }, [contains]);

  const { lines, meta, error, loading } = useLogs(filters, live);
  const set = <K extends keyof LogFilters>(key: K, value: LogFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const filtered = Boolean(filters.host || filters.container || filters.unit || filters.levels.length || filters.contains);

  return (
    <div className="space-y-4">
      <div className="neu flex flex-wrap items-end gap-x-3 gap-y-3 p-3">
        <Field label="host" className="min-w-0 flex-1 sm:flex-none">
          {/* Radix reserves "" for clearing a Select, so "both" needs a value of
              its own rather than the empty string the filter uses. */}
          <Select
            value={filters.host ?? BOTH_HOSTS}
            onValueChange={(next) => set("host", next === BOTH_HOSTS ? null : next)}
          >
            <SelectTrigger className="h-11 w-full text-[14px] sm:h-9 sm:w-28 sm:text-sm" aria-label="Host">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BOTH_HOSTS}>both</SelectItem>
              {(options?.hosts ?? []).map((h) => (
                <SelectItem key={h} value={h}>
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* A datalist rather than a combobox component: there are forty-odd
            containers and a hundred journal units, and the browser's own
            type-to-filter handles that list better than anything worth writing.

            `sm:contents` dissolves this wrapper from `sm` up, so the fields land
            in the filter strip's own flex row exactly as they did before; below
            `sm` it is a column that the disclosure shows and hides. */}
        <div className={cn("w-full flex-col gap-3 sm:contents", moreFilters ? "flex" : "hidden")}>
        <Field label="container" className="w-full sm:w-auto">
          <Input
            list="hub-containers"
            value={filters.container ?? ""}
            placeholder="any"
            onChange={(e) => set("container", e.target.value || null)}
            className="h-11 w-full text-[16px] sm:h-8 sm:w-44 sm:text-[12px]"
          />
          <datalist id="hub-containers">
            {(options?.containers ?? []).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>

        <Field label="journal unit" className="w-full sm:w-auto">
          <Input
            list="hub-units"
            value={filters.unit ?? ""}
            placeholder="any"
            onChange={(e) => set("unit", e.target.value || null)}
            className="h-11 w-full text-[16px] sm:h-8 sm:w-44 sm:text-[12px]"
          />
          <datalist id="hub-units">
            {(options?.units ?? []).map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
        </div>

        <Field label="level" className="w-full sm:w-auto">
          <Toggles
            className="w-full sm:w-fit [&>button]:flex-1 sm:[&>button]:flex-none"
            options={LEVELS}
            value={filters.levels}
            onChange={(next) => set("levels", next)}
            label="Log level"
            toneOf={(l) => LEVEL_TONE[l]}
          />
        </Field>

        <div className={cn("w-full sm:contents", moreFilters ? "block" : "hidden")}>
          <Field label="contains" className="w-full sm:w-auto">
            <Input
              value={contains}
              placeholder="literal text"
              onChange={(e) => setContains(e.target.value)}
              className="h-11 w-full text-[16px] sm:h-8 sm:w-52 sm:text-[12px]"
            />
          </Field>
        </div>

        <Field label="window" className="w-full sm:w-auto">
          <Segmented
            className="w-full sm:w-fit [&>button]:flex-1 sm:[&>button]:flex-none"
            options={RANGES}
            value={filters.range}
            onChange={(r) => set("range", r)}
            label="Time window"
          />
        </Field>

        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <Button
            variant={moreFilters ? "secondary" : "ghost"}
            size="sm"
            className="h-11 sm:hidden"
            aria-expanded={moreFilters}
            onClick={() => setMoreFilters((v) => !v)}
          >
            <SlidersHorizontal className="size-3.5" />
            {moreFilters ? "fewer filters" : "more filters"}
          </Button>

          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 sm:h-8"
              onClick={() => {
                setContains("");
                setFilters({ range: filters.range, host: null, container: null, unit: null, levels: [], contains: "" });
              }}
            >
              <X className="size-3.5" /> clear
            </Button>
          )}
          <Button
            variant={live ? "secondary" : "ghost"}
            size="sm"
            className="ml-auto h-11 sm:ml-0 sm:h-8"
            onClick={() => setLive((v) => !v)}
          >
            {live ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {live ? "tailing" : "paused"}
          </Button>
        </div>
      </div>

      {error && <div className="neu text-tone-bad p-4 text-sm">{error}</div>}

      <LogView
        lines={lines}
        live={live}
        emptyMessage={loading ? "Loading…" : "No lines matched in this window."}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-muted-foreground tnum text-[11px]">
          {lines.length} lines{meta?.truncated ? " · window truncated, narrow the filters or shorten it" : ""}
        </span>
        {meta && (
          <>
            <code className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11px]" title={meta.query}>
              {meta.query}
            </code>
            <a
              href={meta.grafana}
              target="_blank"
              rel="noreferrer"
              className={cn("text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-[11px]")}
            >
              open in Grafana
              <ArrowUpRight className="size-3.5" />
            </a>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex w-full items-center gap-1">{children}</div>
    </div>
  );
}
