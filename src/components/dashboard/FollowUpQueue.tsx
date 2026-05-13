import { useFollowUps } from "../../hooks/useActivities";
import { useUIStore } from "../../store/ui";
import { useContactsStore } from "../../store/contacts";
import { formatPhone } from "../../lib/phone";

export function FollowUpQueue() {
  const { followUps, markDone } = useFollowUps();
  const setView = useUIStore((s) => s.setView);
  const selectContact = useContactsStore((s) => s.selectContact);

  const openContact = async (contactId: number) => {
    await selectContact(contactId);
    setView("contact-detail");
  };

  if (followUps.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          Follow-ups
        </h3>
        <p className="text-xs text-zinc-600 font-mono">No follow-ups due.</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
        Follow-ups ({followUps.length})
      </h3>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {followUps.map((f) => (
          <div
            key={f.activity_id}
            className={`flex items-center gap-3 p-2.5 rounded border ${
              f.overdue
                ? "border-red-800/50 bg-red-950/10"
                : "border-zinc-800"
            }`}
          >
            <button
              onClick={() => markDone(f.activity_id)}
              className="w-4 h-4 rounded border border-zinc-600 shrink-0 hover:border-green-500 transition-colors"
              title="Mark done"
            />
            <div className="flex-1 min-w-0">
              <button
                onClick={() => openContact(f.contact_id)}
                className="text-sm text-zinc-200 hover:text-white font-medium truncate block"
              >
                {f.company_name}
              </button>
              {f.notes && (
                <p className="text-xs text-zinc-500 truncate">{f.notes}</p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-xs font-mono ${f.overdue ? "text-red-400" : "text-zinc-500"}`}>
                {new Date(f.follow_up_at * 1000).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
              {f.phone && (
                <p className="text-xs text-zinc-600 font-mono">{formatPhone(f.phone)}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
