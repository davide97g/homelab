import type { AskStatus } from "@wire";
import { useCallback, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AskComposer } from "@/components/ask/composer";
import { LoginCard } from "@/components/shell/login-card";
import { initialExpanded, rememberSidebar, Sidebar } from "@/components/shell/sidebar";
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
    // need the same pair, and the rail would still run under the cutout.
    <div className="flex h-full flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:flex-row">
      <Sidebar expanded={expanded} onToggle={toggleSidebar} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          data={data}
          refreshedAt={refreshedAt}
          loading={loading}
          onSignOut={() => void signOut()}
          onAsk={() => setAsking(true)}
        />

        {/* The bottom padding carries the home-indicator inset on top of its own
            8, so the last card on a page is never half under the gesture bar. */}
        <main
          key={location.pathname}
          className="animate-in fade-in-0 min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] duration-200 sm:px-6"
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

      {/* Outside <main>, so it is not remounted by the route key and an answer
          survives navigating underneath it. */}
      <AskComposer
        open={asking}
        onClose={() => setAsking(false)}
        unavailable={askStatus && !askStatus.ok ? askStatus.why : null}
      />
    </div>
  );
}
