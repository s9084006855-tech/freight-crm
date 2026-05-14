import { useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import type { DashboardStats } from "../../types";

interface Props {
  stats: DashboardStats;
}

interface StatCardProps {
  label: string;
  value: number;
  accentColor: string;
  glowColor: string;
  delay?: number;
}

function CountUp({ value }: { value: number }) {
  const motionVal = useMotionValue(0);
  const rounded = useTransform(motionVal, (v) => Math.round(v));
  const displayRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(motionVal, value, { duration: 1.2, ease: "easeOut" });
    return controls.stop;
  }, [value, motionVal]);

  useEffect(() => {
    return rounded.on("change", (v) => {
      if (displayRef.current) displayRef.current.textContent = String(v);
    });
  }, [rounded]);

  return <span ref={displayRef}>0</span>;
}

function StatCard({ label, value, accentColor, glowColor, delay = 0 }: StatCardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, [-0.5, 0.5], [6, -6]);
  const rotateY = useTransform(x, [-0.5, 0.5], [-6, 6]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  };

  const handleMouseLeave = () => {
    animate(x, 0, { duration: 0.4, ease: "easeOut" });
    animate(y, 0, { duration: 0.4, ease: "easeOut" });
  };

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{ perspective: 800 }}
    >
      <motion.div
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        whileHover={{ scale: 1.03 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative rounded-2xl px-5 py-5 cursor-default overflow-hidden"
      >
        {/* Glass background */}
        <div
          className="absolute inset-0 rounded-2xl"
          style={{
            background: "rgba(255,255,255,0.03)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        />

        {/* Accent glow in corner */}
        <div
          className="absolute -top-6 -right-6 w-20 h-20 rounded-full pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`,
            filter: "blur(8px)",
          }}
        />

        {/* Top accent line */}
        <div
          className="absolute top-0 left-4 right-4 h-px rounded-full"
          style={{
            background: `linear-gradient(90deg, transparent, ${accentColor}60, transparent)`,
          }}
        />

        {/* Content */}
        <div className="relative">
          <p
            className="text-2xl font-bold font-mono leading-none"
            style={{ color: accentColor }}
          >
            <CountUp value={value} />
          </p>
          <p className="text-xs mt-2" style={{ color: "#6b6b8a" }}>
            {label}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function StatsRow({ stats }: Props) {
  return (
    <div className="grid grid-cols-5 gap-3">
      <StatCard
        label="Total contacts"
        value={stats.total_contacts}
        accentColor="#f0f0f5"
        glowColor="rgba(240,240,245,0.06)"
        delay={0}
      />
      <StatCard
        label="Calls today"
        value={stats.calls_today}
        accentColor="#10b981"
        glowColor="rgba(16,185,129,0.2)"
        delay={0.07}
      />
      <StatCard
        label="Calls this week"
        value={stats.calls_this_week}
        accentColor="#6366f1"
        glowColor="rgba(99,102,241,0.2)"
        delay={0.14}
      />
      <StatCard
        label="Follow-ups due"
        value={stats.follow_ups_due_today}
        accentColor={stats.follow_ups_due_today > 0 ? "#f59e0b" : "#f0f0f5"}
        glowColor={stats.follow_ups_due_today > 0 ? "rgba(245,158,11,0.2)" : "rgba(240,240,245,0.06)"}
        delay={0.21}
      />
      <StatCard
        label="Overdue"
        value={stats.follow_ups_overdue}
        accentColor={stats.follow_ups_overdue > 0 ? "#ef4444" : "#f0f0f5"}
        glowColor={stats.follow_ups_overdue > 0 ? "rgba(239,68,68,0.2)" : "rgba(240,240,245,0.06)"}
        delay={0.28}
      />
    </div>
  );
}
