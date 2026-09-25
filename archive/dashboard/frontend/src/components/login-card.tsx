import { Loader2, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/api";

export function LoginCard({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="canvas-glow relative flex h-full items-center justify-center px-6">
      <form onSubmit={submit} className="panel relative z-10 w-full max-w-sm rounded-xl border border-border/70 p-6">
        <span className="bg-primary/15 text-primary mb-4 flex size-9 items-center justify-center rounded-lg">
          <LockKeyhole className="size-4.5" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">mediarr pipeline</h1>
        <p className="text-muted-foreground mt-1 text-xs">Private dashboard for the homelab media stack.</p>

        <div className="mt-5 space-y-2">
          <Label htmlFor="password" className="text-xs">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
            placeholder="••••••••••"
          />
          {error && <p className="text-destructive text-[11px]">{error}</p>}
        </div>

        <Button type="submit" className="mt-4 w-full" disabled={busy || password.length === 0}>
          {busy && <Loader2 className="animate-spin" />}
          Enter
        </Button>
      </form>
    </div>
  );
}
