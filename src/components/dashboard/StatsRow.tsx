import type { DashboardStats } from "../../types";

interface Props {
  stats: DashboardStats;
}

interface StatCardProps {
  label: string;
  value: number;
  accent?: string;
}

function StatCard({ label, value, accent = "text-zinc-100" }: StatCardProps) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-4">
      <p className={`text-2xl font-semibold font-mono ${accent}`}>{value}</p>
      <p className="text-xs text-zinc-500 mt-1">{label}</p>
    </div>
  );
}

export function StatsRow({ stats }: Props) {
  return (
    <div className="grid grid-cols-5 gap-3">
      <StatCard label="Total contacts" value={stats.total_contacts} />
      <StatCard label="Calls today" value={stats.calls_today} accent="text-green-400" />
      <StatCard label="Calls this week" value={stats.calls_this_week} />
      <StatCard
        label="Follow-ups due"
        value={stats.follow_ups_due_today}
        accent={stats.follow_ups_due_today > 0 ? "text-yellow-400" : "text-zinc-100"}
      />
      <StatCard
        label="Overdue"
        value={stats.follow_ups_overdue}
        accent={stats.follow_ups_overdue > 0 ? "text-red-400" : "text-zinc-100"}
      />
    </div>
  );
}
