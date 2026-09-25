import { useState } from "react";
import { login } from "@/lib/qbit";

/** qBittorrent locks the caller out for an hour after five failures, so this
 *  form never retries on its own and says what went wrong after each attempt. */
export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ok = await login(username, password);
      if (ok) onSuccess();
      else setError("That username and password did not work.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach qBittorrent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-surface p-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Swarm</h1>
        <p className="mt-1 text-[13px] text-muted">Sign in to qBittorrent.</p>

        <label className="mt-6 block text-[13px] text-muted" htmlFor="u">
          Username
        </label>
        <input
          id="u"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          className="mt-1.5 w-full rounded-lg bg-surface-2 px-3 py-2.5 text-[14px]"
        />

        <label className="mt-4 block text-[13px] text-muted" htmlFor="p">
          Password
        </label>
        <input
          id="p"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="mt-1.5 w-full rounded-lg bg-surface-2 px-3 py-2.5 text-[14px]"
        />

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-accent py-2.5 text-[14px] font-medium text-canvas
            transition-opacity duration-[var(--dur-fast)] disabled:opacity-40"
        >
          {busy ? "Signing in" : "Sign in"}
        </button>

        {error ? <p className="mt-4 text-[13px] text-danger">{error}</p> : null}
      </form>
    </div>
  );
}
