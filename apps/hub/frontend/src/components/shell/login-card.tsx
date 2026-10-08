import { LockKeyhole } from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/api";

export function LoginCard({ onAuthed }: { onAuthed: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <form onSubmit={submit} className="neu rise-in w-full max-w-sm space-y-5 p-6">
        <div className="space-y-1.5">
          <div className="mb-4 flex items-center justify-between">
            <Logo className="size-10" />
            <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-md">
              <LockKeyhole className="size-4" />
            </span>
          </div>
          <h1 className="text-xl font-medium tracking-tight">homelab hub</h1>
          <p className="text-muted-foreground text-sm">Monitoring for the mini PC and the NAS.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-muted-foreground font-normal">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p className="text-tone-bad text-sm">{error}</p>}

        <Button type="submit" className="w-full" disabled={busy || password.length === 0}>
          {busy ? "Checking…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
