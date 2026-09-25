import "@xyflow/react/dist/style.css";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { DetailDrawer } from "@/components/detail-drawer";
import { LoginCard } from "@/components/login-card";
import { PipelineGraph } from "@/components/pipeline-graph";
import { TopBar } from "@/components/top-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useOverview } from "@/hooks/use-overview";
import { fetchSession, logout } from "@/lib/api";

function Dashboard({ onSignedOut }: { onSignedOut: () => void }) {
  const { data, error, loading, expired, refreshedAt, refresh } = useOverview(5000);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (expired) onSignedOut();
  }, [expired, onSignedOut]);

  const select = useCallback((id: string) => setSelected(id === "" ? null : (prev) => (prev === id ? null : id)), []);
  const snapshot = data?.services.find((s) => s.id === selected) ?? null;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        data={data}
        refreshedAt={refreshedAt}
        loading={loading}
        error={error}
        onRefresh={() => void refresh()}
        onLogout={async () => {
          await logout();
          onSignedOut();
        }}
      />

      <main className="canvas-glow relative min-h-0 flex-1">
        {data ? (
          <PipelineGraph data={data} selected={selected} onSelect={select} />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {error ?? "Reading the pipeline…"}
          </div>
        )}
        <DetailDrawer snapshot={snapshot} onClose={() => setSelected(null)} />
      </main>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    void fetchSession()
      .then(setAuthed)
      .catch(() => setAuthed(false));
  }, []);

  return (
    <TooltipProvider>
      {authed === null ? (
        <div className="text-muted-foreground flex h-full items-center justify-center">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : authed ? (
        <Dashboard onSignedOut={() => setAuthed(false)} />
      ) : (
        <LoginCard onSuccess={() => setAuthed(true)} />
      )}
    </TooltipProvider>
  );
}
