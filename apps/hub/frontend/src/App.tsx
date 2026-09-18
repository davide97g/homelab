import { useCallback, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { LoginCard } from "@/components/shell/login-card";
import { initialExpanded, rememberSidebar, Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePoll } from "@/hooks/use-poll";
import { fetchSession, fetchSummary, logout } from "@/lib/api";
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
        <div className="text-muted-foreground flex h-full items-center justify-center text-sm">Checking session…</div>
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
  const { data, error, loading, expired, refreshedAt, refresh } = usePoll(load, 5000);
  const [expanded, setExpanded] = useState(initialExpanded);

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
    <div className="flex h-full flex-col sm:flex-row">
      <Sidebar expanded={expanded} onToggle={toggleSidebar} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          data={data}
          refreshedAt={refreshedAt}
          loading={loading}
          onRefresh={refresh}
          onSignOut={() => void signOut()}
        />

        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-6">
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
            <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">Loading…</div>
          )}
        </main>
      </div>
    </div>
  );
}
