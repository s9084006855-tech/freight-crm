import { useState, useEffect, type ReactNode } from "react";
import type { StartupCheckResult } from "../../types";
import * as db from "../../lib/db";
import { humanError } from "../../lib/errors";

interface Props {
  children: ReactNode;
}

export function StartupCheck({ children }: Props) {
  const [result, setResult] = useState<StartupCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db.runStartupCheck().then(setResult).catch((e) => setError(humanError(e)));
  }, []);

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
          Open Settings (⌘,) to enter your Turso database URL and token.
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
        <div className="mt-4 flex gap-2">
          <button
            onClick={recheck}
            className="px-3 py-1.5 text-xs font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded"
          >
            Recheck
          </button>
          <button
            onClick={() => setResult({ all_passed: true, checks: [] })}
            className="px-3 py-1.5 text-xs font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-500 rounded"
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}
