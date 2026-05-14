import { useState, useRef, useEffect } from "react";
import { useUIStore } from "../../store/ui";
import { useContactsStore } from "../../store/contacts";
import * as db from "../../lib/db";
import { useToast } from "../../hooks/useToast";
import { humanError } from "../../lib/errors";
import type { UserProfile } from "../../types";

const OUTCOMES = ["Reached", "No answer", "Voicemail", "Not interested", "Callback"];

export function QuickCallModal({ activeUser }: { activeUser: UserProfile }) {
  const contactId = useUIStore((s) => s.quickCallContactId);
  const close = useUIStore((s) => s.closeQuickCall);
  const contact = useContactsStore((s) => s.selected);
  const refreshSelected = useContactsStore((s) => s.refreshSelected);
  const toast = useToast();

  const [outcome, setOutcome] = useState("Reached");
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [saving, setSaving] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (contactId != null) {
      setOutcome("Reached");
      setNotes("");
      setFollowUpDate("");
      setTimeout(() => notesRef.current?.focus(), 0);
    }
  }, [contactId]);

  const save = async () => {
    if (!contactId) return;
    setSaving(true);
    try {
      const followUpTs = followUpDate
        ? Math.floor(new Date(followUpDate).getTime() / 1000)
        : undefined;
      await db.logActivity({
        contact_id: contactId,
        activity_type: "call",
        outcome,
        notes: notes.trim() || undefined,
        follow_up_at: followUpTs,
        user_id: activeUser.id,
      });
      await refreshSelected();
      toast.success("Call logged");
      close();
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
    if (e.key === "Escape") close();
  };

  if (contactId == null) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">
            Log call{contact ? ` — ${contact.company_name}` : ""}
          </h2>
        </div>
        <div className="px-5 py-4 space-y-4" onKeyDown={onKey}>
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Outcome</label>
            <div className="flex flex-wrap gap-2">
              {OUTCOMES.map((o) => (
                <button
                  key={o}
                  onClick={() => setOutcome(o)}
                  className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
                    outcome === o
                      ? "bg-zinc-700 border-zinc-500 text-zinc-100"
                      : "bg-transparent border-zinc-700 text-zinc-400 hover:border-zinc-500"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Notes</label>
            <textarea
              ref={notesRef}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional…"
              rows={3}
              className="w-full px-2.5 py-2 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Follow-up date (optional)</label>
            <input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className="h-8 px-2.5 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={close}
              className="px-4 py-1.5 text-sm font-mono text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-1.5 text-sm font-mono bg-green-900/50 border border-green-700 text-green-200 rounded hover:bg-green-900/80 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Log call (⌘↵)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
