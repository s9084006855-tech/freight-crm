import { useState, useEffect, type ReactNode } from "react";
import type { StartupCheckResult } from "../../types";
import * as db from "../../lib/db";
import { humanError } from "../../lib/errors";
import { useUIStore } from "../../store/ui";
import { useSyncStore } from "../../store/sync";

interface Props {
  children: ReactNode;
}

export function StartupCheck({ children }: Props) {
  const [result, setResult] = useState<StartupCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTursoForm, setShowTursoForm] = useState(false);
  const [tursoUrl, setTursoUrl] = useState("");
  const [tursoToken, setTursoToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const setView = useUIStore((s) => s.setView);
  const refreshSync = useSyncStore((s) => s.fetchStatus);

  useEffect(() => {
    let cancelled = false;
    const tryCheck = async (attemptsLeft: number) => {
      try {
        const r = await db.runStartupCheck();
        if (cancelled) return;
        // If Turso creds are saved but connection hasn't established yet,
        // give the background auto-reconnect a moment and retry.
        const credsOk = r.checks.find((c) => c.name === "Turso credentials")?.passed;
        const dbOk = r.checks.find((c) => c.name === "Database connection")?.passed;
        if (credsOk && !dbOk && attemptsLeft > 0) {
          setTimeout(() => tryCheck(attemptsLeft - 1), 700);
          return;
        }
        setResult(r);
      } catch (e) {
        if (!cancelled) setError(humanError(e));
      }
    };
    tryCheck(6); // ~4.2s of retries
    return () => { cancelled = true; };
  }, []);

  const handleConnectTurso = async () => {
    if (!tursoUrl.trim() || !tursoToken.trim()) {
      setConnectError("Both URL and token are required");
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      await db.connectTurso(tursoUrl.trim(), tursoToken.trim());
      const fresh = await db.runStartupCheck();
      setResult(fresh);
      await refreshSync();
      setShowTursoForm(false);
      setTursoUrl("");
      setTursoToken("");
    } catch (e) {
      setConnectError(humanError(e));
    } finally {
      setConnecting(false);
    }
  };

  if (!result && !error) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <p className="text-xs text-zinc-500 font-mono animate-pulse">Starting…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 p-8">
        <div className="max-w-sm text-center">
          <p className="text-red-400 text-sm font-mono mb-2">Startup failed</p>
          <p className="text-zinc-500 text-xs font-mono">{error}</p>
        </div>
      </div>
    );
  }

  const failing = result!.checks.filter((c) => !c.passed);

  if (failing.length === 0) return <>{children}</>;

  const recheck = async () => {
    db.runStartupCheck().then(setResult).catch((e) => setError(humanError(e)));
  };

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 p-8">
      <div className="w-full max-w-md">
        <h1 className="text-sm font-semibold text-zinc-100 mb-2">Startup issues</h1>
        <p className="text-xs text-zinc-500 mb-4 font-mono">
          Configure your Turso database to continue.
        </p>
        <div className="space-y-3">
          {result!.checks.map((check) => (
            <div
              key={check.name}
              className={`rounded border px-4 py-3 text-xs font-mono ${
                check.passed
                  ? "border-zinc-800 text-zinc-500"
                  : "border-red-800 text-red-300 bg-red-950/20"
              }`}
            >
              <span>{check.passed ? "✓" : "✕"} {check.name}</span>
              {check.message && (
                <p className="mt-1 text-zinc-500">{check.message}</p>
              )}
            </div>
          ))}
        </div>

        {showTursoForm && (
          <div className="mt-4 space-y-2 p-4 border border-zinc-800 rounded bg-zinc-900/50">
            <p className="text-xs text-zinc-400 font-mono mb-2">
              Get your URL and token from <span className="text-zinc-300">turso.tech</span>
            </p>
            <input
              autoFocus
              value={tursoUrl}
              onChange={(e) => setTursoUrl(e.target.value)}
              placeholder="libsql://your-db.turso.io"
              disabled={connecting}
              className="w-full h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500 disabled:opacity-50"
            />
            <input
              value={tursoToken}
              onChange={(e) => setTursoToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConnectTurso(); }}
              type="password"
              placeholder="eyJhbGci… (auth token)"
              disabled={connecting}
              className="w-full h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500 disabled:opacity-50"
            />
            {connectError && (
              <p className="text-xs text-red-400 font-mono">{connectError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleConnectTurso}
                disabled={connecting || !tursoUrl.trim() || !tursoToken.trim()}
                className="px-3 py-1.5 text-xs font-mono bg-indigo-700 hover:bg-indigo-600 text-white rounded disabled:opacity-50"
              >
                {connecting ? "Connecting…" : "Connect"}
              </button>
              <button
                onClick={() => { setShowTursoForm(false); setConnectError(null); }}
                disabled={connecting}
                className="px-3 py-1.5 text-xs font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={recheck}
            className="px-3 py-1.5 text-xs font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded"
          >
            Recheck
          </button>
          {!showTursoForm && (
            <button
              onClick={() => setShowTursoForm(true)}
              className="px-3 py-1.5 text-xs font-mono bg-indigo-700 hover:bg-indigo-600 text-white rounded"
            >
              Configure Turso
            </button>
          )}
          <button
            onClick={() => { setView("settings"); setResult({ all_passed: true, checks: [] }); }}
            className="px-3 py-1.5 text-xs font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-500 rounded"
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}
