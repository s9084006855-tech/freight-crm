import { useActivities } from "../../hooks/useActivities";
import type { Activity } from "../../types";

interface Props {
  contactId: number;
}

const TYPE_LABELS: Record<string, string> = {
  call: "Call",
  email: "Email",
  note: "Note",
  meeting: "Meeting",
  voicemail: "Voicemail",
};

const OUTCOME_COLORS: Record<string, string> = {
  reached: "text-green-400",
  "no answer": "text-zinc-500",
  voicemail: "text-yellow-400",
  "not interested": "text-red-400",
  callback: "text-blue-400",
};

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ActivityItem({ activity }: { activity: Activity }) {
  const typeLabel = TYPE_LABELS[activity.activity_type] ?? activity.activity_type;
  const outcomeColor = activity.outcome
    ? (OUTCOME_COLORS[activity.outcome.toLowerCase()] ?? "text-zinc-400")
    : "text-zinc-400";

  return (
    <div className="flex gap-4 py-3 border-b border-zinc-800/50">
      <div className="shrink-0 text-right w-24">
        <p className="text-xs text-zinc-600 font-mono">{formatTs(activity.created_at)}</p>
        <p className="text-xs text-zinc-500 mt-0.5">{typeLabel}</p>
      </div>
      <div className="flex-1 min-w-0">
        {activity.outcome && (
          <p className={`text-xs font-medium mb-0.5 ${outcomeColor}`}>{activity.outcome}</p>
        )}
        {activity.notes && (
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">{activity.notes}</p>
        )}
        {activity.follow_up_at && !activity.follow_up_done && (
          <p className="text-xs text-yellow-400 mt-1 font-mono">
            Follow-up: {formatTs(activity.follow_up_at)}
          </p>
        )}
      </div>
    </div>
  );
}

export function ActivityFeed({ contactId }: Props) {
  const { activities, loading } = useActivities(contactId);

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-zinc-800 shrink-0">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          Activity ({activities.length})
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto px-5">
        {loading && (
          <p className="text-xs text-zinc-600 font-mono py-4">Loading…</p>
        )}
        {!loading && activities.length === 0 && (
          <p className="text-xs text-zinc-600 font-mono py-4">
            No activity yet. Press C to log a call.
          </p>
        )}
        {activities.map((a) => (
          <ActivityItem key={a.id} activity={a} />
        ))}
      </div>
    </div>
  );
}
