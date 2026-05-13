import { useState, useEffect } from "react";
import type { ImportSession } from "../../types";
import * as db from "../../lib/db";
import { useToast } from "../../hooks/useToast";
import { humanError } from "../../lib/errors";

interface RollbackConfirm {
  session: ImportSession;
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function ImportHistory({ onRollbackDone }: { onRollbackDone?: () => void }) {
  const [sessions, setSessions] = useState<ImportSession[]>([]);
  const [confirm, setConfirm] = useState<RollbackConfirm | null>(null);
  const [rolling, setRolling] = useState(false);
  const toast = useToast();

  useEffect(() => {
    db.getImportSessions().then(setSessions).catch(() => {});
  }, []);

  const rollback = async (session: ImportSession) => {
    setRolling(true);
    try {
      await db.rollbackImport(session.id);
      const fresh = await db.getImportSessions();
      setSessions(fresh);
      toast.success("Import rolled back");
      setConfirm(null);
      onRollbackDone?.();
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setRolling(false);
    }
  };

  if (sessions.length === 0) {
    return (
      <p className="text-xs text-zinc-600 font-mono py-4">No import history.</p>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center justify-between px-4 py-3 bg-zinc-900 border border-zinc-800 rounded">
          <div>
            <p className="text-sm text-zinc-200 font-medium">{s.source_name ?? s.source_type}</p>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">
              {formatDate(s.started_at)} · Added {s.contacts_added} · Merged {s.contacts_merged} · Discarded {s.contacts_discarded}
            </p>
          </div>
          {s.status === "completed" && (
            <button
              onClick={() => setConfirm({ session: s })}
              className="text-xs text-zinc-500 hover:text-red-400 font-mono transition-colors"
            >
              Rollback
            </button>
          )}
        </div>
      ))}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-zinc-100 mb-3">Confirm rollback</h2>
            <p className="text-sm text-zinc-300 mb-6">
              This will remove <strong>{confirm.session.contacts_added} contacts</strong> added on{" "}
              <strong>{formatDate(confirm.session.started_at)}</strong> from{" "}
              <strong>{confirm.session.source_name ?? confirm.session.source_type}</strong>.
              Any edits you've made to those contacts since import will be lost.
              Contacts added or edited from other sources are not affected.
              Continue?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirm(null)}
                className="px-4 py-1.5 text-sm font-mono text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={() => rollback(confirm.session)}
                disabled={rolling}
                className="px-4 py-1.5 text-sm font-mono bg-red-900/50 border border-red-700 text-red-300 rounded hover:bg-red-900/80 disabled:opacity-50"
              >
                {rolling ? "Rolling back…" : "Rollback"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
