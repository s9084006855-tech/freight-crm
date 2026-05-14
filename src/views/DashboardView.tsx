import { useState, useEffect } from "react";
import { motion } from "framer-motion";
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
        <div className="flex flex-col items-center gap-3">
          <motion.div
            className="w-8 h-8 rounded-full"
            style={{
              border: "2px solid rgba(99,102,241,0.3)",
              borderTopColor: "#6366f1",
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
          />
          <p className="text-xs font-mono" style={{ color: "#4a4a65" }}>
            Loading…
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="h-full overflow-y-auto p-6 space-y-5"
    >
      {/* Header */}
      <motion.div
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="flex items-baseline justify-between mb-1"
      >
        <div>
          <h1 className="text-lg font-semibold" style={{ color: "#f0f0f5" }}>
            Dashboard
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "#4a4a65" }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
      </motion.div>

      <StatsRow stats={stats} />

      <div className="grid grid-cols-2 gap-5">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <FollowUpQueue />
        </motion.div>
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.42, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <USHeatmap data={stats.contacts_by_state} onStateClick={onStateClick} />
        </motion.div>
      </div>
    </motion.div>
  );
}
