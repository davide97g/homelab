import type { AskStatus } from "@wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AskComposer } from "@/components/ask/composer";
import { LoginCard } from "@/components/shell/login-card";
import { initialExpanded, rememberSidebar, Sidebar, TabBar } from "@/components/shell/sidebar";
import { Booting } from "@/components/shell/trace";
import { TopBar } from "@/components/shell/top-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePoll } from "@/hooks/use-poll";
import { fetchAskStatus, fetchSession, fetchSummary, logout } from "@/lib/api";
import { PAGES } from "@/pages/registry";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    fetchSession()
      .then((s) => setAuthed(s.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  return (
    <TooltipProvider delayDuration={120}>
      {authed === null ? (
        <Booting label="checking your session" />
      ) : authed ? (
        <Shell onSignedOut={() => setAuthed(false)} />
      ) : (
        <LoginCard onAuthed={() => setAuthed(true)} />
      )}
    </TooltipProvider>
  );
}

function Shell({ onSignedOut }: { onSignedOut: () => void }) {
  const load = useCallback((signal: AbortSignal) => fetchSummary(signal), []);
  const { data, error, loading, expired, refreshedAt } = usePoll(load, 5000);
  const [expanded, setExpanded] = useState(initialExpanded);
  const [asking, setAsking] = useState(false);
  // A question typed somewhere other than the composer (the sidebar panel):
  // the composer opens already answering it.
  const [question, setQuestion] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const scroller = useRef<HTMLElement>(null);
  const [askStatus, setAskStatus] = useState<AskStatus | null>(null);
  const location = useLocation();

  // Read once. A box with no key still gets the composer -- it opens and says
  // which variable is missing, rather than a CTA that quietly does nothing.
  useEffect(() => {
    fetchAskStatus()
      .then(setAskStatus)
      .catch(() => setAskStatus({ ok: false, why: "could not reach the hub" }));
  }, []);

  // The shortcut lives here rather than in the composer, because the composer
  // does not exist until it is open and something has to be listening.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setAsking(true);
      }
    }
    const open = () => setAsking(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("hub:ask", open);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hub:ask", open);
    };
  }, []);

  useSpotlight();

  // The page scrolls inside <main>, not the window, so the top bar is told
  // when something has slid under it. Only the crossing re-renders.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setStuck(el.scrollTop > 4);
    const onScroll = () => setStuck(el.scrollTop > 4);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [location.pathname]);

  function ask(q?: string) {
    setQuestion(q ?? null);
    setAsking(true);
  }

  useEffect(() => {
    if (expired) onSignedOut();
  }, [expired, onSignedOut]);

  function toggleSidebar() {
    setExpanded((was) => {
      rememberSidebar(!was);
      return !was;
    });
  }

  async function signOut() {
    await logout().catch(() => undefined);
    onSignedOut();
  }

  return (
    // The left/right safe-area insets live on the shell rather than on each
    // child: in landscape on a notched phone every one of them would otherwise
    // need the same pair.
    <div className="flex h-full pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <div className="hidden shrink-0 py-6 pl-6 lg:block">
        <Sidebar data={data} expanded={expanded} onToggle={toggleSidebar} onAsk={ask} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          data={data}
          refreshedAt={refreshedAt}
          loading={loading}
          stuck={stuck}
          onSignOut={() => void signOut()}
          onAsk={() => ask()}
        />

        {/* The bottom padding clears the phone tab bar and the home indicator,
            so the last card on a page is never under either. */}
        <main
          ref={scroller}
          key={location.pathname}
          className="animate-in fade-in-0 pb-tabbar min-h-0 flex-1 overflow-y-auto px-4 pt-1 duration-300 lg:px-6 lg:pb-8"
        >
          {error && !data && (
            <div className="neu text-tone-bad mx-auto mt-6 max-w-lg p-5 text-sm">
              Could not reach the hub's API: {error}
            </div>
          )}

          {data && (
            <Routes>
              {PAGES.map(({ path, element }) => (
                <Route key={path} path={path} element={element(data)} />
              ))}
              {/* Any unknown path lands on the overview rather than a dead end. */}
              <Route path="*" element={PAGES[0]!.element(data)} />
            </Routes>
          )}

          {!data && !error && (
            <div className="flex h-72 items-center justify-center">
              <Booting label="reading both machines" />
            </div>
          )}
        </main>
      </div>

      <TabBar onSignOut={() => void signOut()} />

      {/* Outside <main>, so it is not remounted by the route key and an answer
          survives navigating underneath it. */}
      <AskComposer
        open={asking}
        question={question}
        onClose={() => {
          setAsking(false);
          setQuestion(null);
        }}
        unavailable={askStatus && !askStatus.ok ? askStatus.why : null}
      />
    </div>
  );
}

/** Cards light up under the pointer (`.neu::after` in index.css): one listener
 *  for the whole page, at most once a frame. */
function useSpotlight() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const onMove = (e: PointerEvent) => {
      last = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const card = (last?.target as Element | null)?.closest?.<HTMLElement>(".neu");
        if (!card || !last) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${last.clientX - r.left}px`);
        card.style.setProperty("--my", `${last.clientY - r.top}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
}
