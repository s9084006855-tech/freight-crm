import { useState, useEffect } from "react";
import type { DashboardStats } from "../types";
import { StatsRow } from "../components/dashboard/StatsRow";
import { FollowUpQueue } from "../components/dashboard/FollowUpQueue";
import { USHeatmap } from "../components/dashboard/USHeatmap";
import { useUIStore } from "../store/ui";
import { useContactsStore } from "../store/contacts";
import * as db from "../lib/db";

export function DashboardView() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const setView = useUIStore((s) => s.setView);
  const setFilter = useContactsStore((s) => s.setFilter);

  useEffect(() => {
    db.getDashboardStats().then(setStats).catch(() => {});
  }, []);

  const onStateClick = (state: string) => {
    setFilter({ state });
    setView("contacts");
  };

  if (!stats) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-zinc-600 font-mono animate-pulse">Loading…</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <StatsRow stats={stats} />
      <div className="grid grid-cols-2 gap-6">
        <FollowUpQueue />
        <USHeatmap data={stats.contacts_by_state} onStateClick={onStateClick} />
      </div>
    </div>
  );
}
