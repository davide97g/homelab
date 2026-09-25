import type { AskResponse, ChartSpec } from "@wire";
import { ArrowUp, ArrowUpRight, Mic, Pin, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AskResult } from "@/components/ask/result";
import { FieldLabel } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { useSpeech } from "@/hooks/use-speech";
import { askQuestion } from "@/lib/api";
import { cn } from "@/lib/utils";
import { pin } from "@/lib/pinned";

// The composer: a question at the bottom of the screen, its answer above it.
//
// Not a Radix Dialog, though the dependency is installed. A dialog traps focus,
// locks scroll and marks the rest of the page inert, all of which are right for
// a form that must be dealt with and wrong here -- the answer is a chart, and
// the page behind it is the context you are asking about. This is a plain fixed
// layer with its own Escape handler, which is the whole of what a dialog would
// have given that this needs.

const EXAMPLES = [
  "temperatures of the mini pc and the NAS compared, last 2 weeks, line at 50°",
  "the 10 most consuming services on the mini pc",
  "how much power has the box been drawing this week",
];

export function AskComposer({
  open,
  onClose,
  unavailable,
}: {
  open: boolean;
  onClose: () => void;
  /** Set when the box has no key. The composer still opens and says so, rather
   *  than the CTA silently doing nothing. */
  unavailable: string | null;
}) {
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const speech = useSpeech(
    useCallback((text: string, final: boolean) => {
      setPrompt(text);
      // A finished sentence is almost always the whole question, but submitting
      // it automatically would take the decision away at exactly the moment a
      // misheard word needs fixing. The text lands in the box; Enter is still
      // yours.
      if (final) input.current?.focus();
    }, []),
  );

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(text: string) {
    const question = text.trim();
    if (!question || asking) return;
    speech.stop();
    setAsking(true);
    setError(null);
    setAnswer(null);
    setPinned(false);
    try {
      setAnswer(await askQuestion(question));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  }

  function keep(spec: ChartSpec) {
    pin({ prompt: answer?.prompt ?? prompt, spec, at: new Date().toISOString() });
    setPinned(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* The scrim. Click-through is deliberate on the blur only: the click
          closes, so the page you were looking at is one tap away. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="animate-in fade-in-0 bg-background/45 absolute inset-0 cursor-default backdrop-blur-md duration-200 motion-reduce:animate-none"
      />

      <div className="pointer-events-none relative flex max-h-full flex-col justify-end gap-3 p-4 sm:p-6">
        {(answer || asking || error || unavailable) && (
          <div className="animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto mx-auto w-full max-w-5xl overflow-y-auto duration-200 motion-reduce:animate-none">
            {unavailable ? (
              <Card>
                <p className="text-sm">Asking is not set up on this box.</p>
                <p className="text-muted-foreground mt-1 text-[12px]">{unavailable}</p>
              </Card>
            ) : error ? (
              <Card className="text-tone-bad">{error}</Card>
            ) : asking ? (
              <Card className="text-muted-foreground flex items-center gap-2 text-sm">
                <Sparkles className="size-3.5 animate-pulse" />
                Reading your question…
              </Card>
            ) : answer?.spec ? (
              <Answered answer={answer} spec={answer.spec} pinned={pinned} onPin={() => keep(answer.spec!)} />
            ) : answer ? (
              <Refused answer={answer} onPick={(id) => void submit(`${answer.prompt} (${id})`)} />
            ) : null}
          </div>
        )}

        {!answer && !asking && !unavailable && (
          <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-wrap justify-center gap-1.5">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => void submit(e)}
                className="glass text-muted-foreground hover:text-foreground rounded-full px-3 py-1.5 text-[11px] transition-colors"
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {/* The composer proper. `.glass` is the app's existing blurred surface —
            the same one the chart tooltip uses — so this reads as part of the
            hub rather than as something bolted to the front of it. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(prompt);
          }}
          className="animate-in slide-in-from-bottom-4 glass pointer-events-auto mx-auto flex w-full max-w-3xl items-center gap-2 p-2 pl-4 duration-200 motion-reduce:animate-none"
        >
          <Sparkles className="text-muted-foreground size-4 shrink-0" />
          <input
            ref={input}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={speech.listening ? "Listening…" : "Ask for a chart, a ranking or a number…"}
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
            autoComplete="off"
            spellCheck={false}
          />

          {speech.supported && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={speech.listening ? "Stop dictating" : "Dictate"}
              title={speech.error ?? (speech.listening ? "Stop dictating" : "Dictate")}
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
              className={cn(speech.listening && "text-tone-bad")}
            >
              <Mic className={cn("size-4", speech.listening && "animate-pulse")} />
            </Button>
          )}

          <Button type="submit" size="icon-sm" disabled={!prompt.trim() || asking} aria-label="Ask">
            <ArrowUp className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </form>

        <p className="text-muted-foreground pointer-events-none mx-auto text-center text-[10px]">
          {speech.error
            ? `Microphone: ${speech.error}`
            : answer
              ? `Answered in ${answer.tookMs} ms · Esc to close`
              : "Your words are sent to TypeSafe's Jev to be read. Metric values never leave the box."}
        </p>
      </div>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("glass mx-auto max-w-3xl p-4 text-sm", className)}>{children}</div>;
}

function Answered({
  answer,
  spec,
  pinned,
  onPin,
}: {
  answer: AskResponse;
  spec: ChartSpec;
  pinned: boolean;
  onPin: () => void;
}) {
  const u = answer.understood;
  return (
    <div className="space-y-2">
      <div className="glass flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* A table is a reading of right now, so a range on it would be a
              label for something the answer does not use. */}
          {spec.shape === "chart" && <FieldLabel>{u.range}</FieldLabel>}
          <FieldLabel>{u.instance === "both" ? "both machines" : u.instance}</FieldLabel>
          {spec.shape === "table" && spec.rankBy && <FieldLabel>by {spec.rankBy}</FieldLabel>}
          {u.threshold && <FieldLabel>line at {u.threshold.label}</FieldLabel>}
        </div>
        <Button variant="ghost" size="sm" onClick={onPin} disabled={pinned}>
          <Pin className="size-3.5" />
          {pinned ? "Pinned to /ask" : "Pin"}
        </Button>
      </div>
      <AskResult spec={spec} />
    </div>
  );
}

/** A refusal that says what it read and what it has instead.
 *
 *  This is the shape the whole design turns on: the catalogue is finite, so
 *  "no" is a normal answer and has to be a useful one. The chips are the
 *  candidates that did not clear the floor, and the Grafana link is the same
 *  escape hatch every panel carries. */
function Refused({ answer, onPick }: { answer: AskResponse; onPick: (title: string) => void }) {
  const near = answer.understood.candidates.filter((c) => c.score > 0.15).slice(0, 4);
  return (
    <Card>
      <p>{answer.reason}</p>
      {near.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {near.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c.title)}
              className="neu-inset text-muted-foreground hover:text-foreground rounded-full px-3 py-1.5 text-[11px] transition-colors"
            >
              {c.title}
            </button>
          ))}
        </div>
      )}
      {answer.grafana && (
        <a
          href={answer.grafana}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground mt-3 inline-flex items-center gap-1 text-[11px]"
        >
          Ask it in Grafana Explore <ArrowUpRight className="size-3" />
        </a>
      )}
    </Card>
  );
}
