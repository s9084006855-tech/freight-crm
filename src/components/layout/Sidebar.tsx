import { motion } from "framer-motion";
import { LayoutDashboard, Users, Upload, Settings, Truck, LogOut, Compass } from "lucide-react";
import { useUIStore } from "../../store/ui";
import { useSyncStore } from "../../store/sync";
import type { ViewName, SyncStatusColor, UserProfile } from "../../types";

interface NavItem {
  view: ViewName;
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; color?: string }>;
}

const NAV: NavItem[] = [
  { view: "dashboard", label: "Dashboard", shortcut: "1", icon: LayoutDashboard },
  { view: "contacts", label: "Contacts", shortcut: "2", icon: Users },
  { view: "import", label: "Import", shortcut: "3", icon: Upload },
  { view: "settings", label: "Settings", shortcut: ",", icon: Settings },
];

type DotColor = SyncStatusColor | "gray";

const SYNC_COLORS: Record<DotColor, { dot: string; glow: string; label: string }> = {
  green: { dot: "#10b981", glow: "rgba(16,185,129,0.5)", label: "Synced" },
  yellow: { dot: "#f59e0b", glow: "rgba(245,158,11,0.5)", label: "Pending" },
  red: { dot: "#ef4444", glow: "rgba(239,68,68,0.5)", label: "Error" },
  gray: { dot: "#4a4a65", glow: "transparent", label: "No sync" },
};

interface SidebarProps {
  activeUser: UserProfile;
  onSwitchUser: () => void;
}

export function Sidebar({ activeUser, onSwitchUser }: SidebarProps) {
  const activeView = useUIStore((s) => s.activeView);
  const setView = useUIStore((s) => s.setView);
  const syncStatus = useSyncStore((s) => s.status);
  const syncColor: DotColor = syncStatus?.status ?? "gray";
  const sync = SYNC_COLORS[syncColor];

  return (
    <motion.nav
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="w-52 shrink-0 flex flex-col h-full"
      style={{
        background: "rgba(255,255,255,0.02)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Logo */}
      <div className="px-5 py-6">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              boxShadow: "0 4px 12px rgba(99,102,241,0.4)",
            }}
          >
            <Truck size={15} strokeWidth={2} className="text-white" />
          </div>
          <div>
            <p
              className="text-sm font-semibold leading-none"
              style={{
                background: "linear-gradient(135deg, #f0f0f5, #8b8ba8)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Freight CRM
            </p>
            <p className="text-xs mt-0.5" style={{ color: "#4a4a65" }}>
              v0.1.0
            </p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 mb-3" style={{ height: 1, background: "rgba(255,255,255,0.05)" }} />

      {/* Nav items */}
      <div className="flex-1 px-3 space-y-1">
        {activeUser.id === "francisco" && (() => {
          const isActive = activeView === "strategy-map";
          return (
            <motion.button
              key="strategy-map"
              initial={{ x: -10, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0, duration: 0.3 }}
              onClick={() => setView("strategy-map")}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all duration-200 group relative"
              style={{
                background: isActive ? "rgba(245,158,11,0.12)" : "transparent",
                border: isActive ? "1px solid rgba(245,158,11,0.3)" : "1px solid transparent",
                boxShadow: isActive ? "0 0 16px rgba(245,158,11,0.08), inset 0 1px 0 rgba(255,255,255,0.06)" : "none",
                color: isActive ? "#fcd34d" : "#6b6b8a",
              }}
              whileHover={{ scale: 1.01, transition: { duration: 0.15 } }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="flex items-center gap-2.5">
                <Compass size={15} strokeWidth={isActive ? 2.2 : 1.8} color={isActive ? "#fbbf24" : "#6b6b8a"} />
                <span className={isActive ? "font-medium" : "font-normal"}>Strategy Map</span>
              </span>
              {isActive && (
                <motion.div
                  layoutId="active-bar"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                  style={{ background: "linear-gradient(180deg, #f59e0b, #d97706)" }}
                  transition={{ type: "spring", stiffness: 400, damping: 35 }}
                />
              )}
            </motion.button>
          );
        })()}
        {NAV.map((item, i) => {
          const Icon = item.icon;
          const isActive = activeView === item.view;
          return (
            <motion.button
              key={item.view}
              initial={{ x: -10, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.05 * i, duration: 0.3 }}
              onClick={() => setView(item.view)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all duration-200 group relative"
              style={{
                background: isActive ? "rgba(99,102,241,0.15)" : "transparent",
                border: isActive
                  ? "1px solid rgba(99,102,241,0.35)"
                  : "1px solid transparent",
                boxShadow: isActive
                  ? "0 0 16px rgba(99,102,241,0.12), inset 0 1px 0 rgba(255,255,255,0.06)"
                  : "none",
                color: isActive ? "#c7d2fe" : "#6b6b8a",
              }}
              whileHover={{
                scale: 1.01,
                transition: { duration: 0.15 },
              }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="flex items-center gap-2.5">
                <Icon
                  size={15}
                  strokeWidth={isActive ? 2.2 : 1.8}
                  color={isActive ? "#818cf8" : "#6b6b8a"}
                />
                <span className={isActive ? "font-medium" : "font-normal"}>
                  {item.label}
                </span>
              </span>
              <span
                className="text-xs font-mono"
                style={{ color: isActive ? "rgba(129,140,248,0.6)" : "rgba(74,74,101,0.8)" }}
              >
                ⌘{item.shortcut}
              </span>

              {/* Active indicator bar */}
              {isActive && (
                <motion.div
                  layoutId="active-bar"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                  style={{ background: "linear-gradient(180deg, #6366f1, #8b5cf6)" }}
                  transition={{ type: "spring", stiffness: 400, damping: 35 }}
                />
              )}
            </motion.button>
          );
        })}
      </div>

      {/* User + sync footer */}
      <div className="px-3 py-4 space-y-2">
        {/* Active user */}
        <div
          className="flex items-center justify-between px-3 py-2 rounded-xl"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
              style={{ background: activeUser.color, boxShadow: `0 2px 8px ${activeUser.color}40` }}
            >
              {activeUser.initials}
            </div>
            <span className="text-xs font-medium truncate max-w-[90px]" style={{ color: "#8b8ba8" }}>
              {activeUser.display_name.split(" ")[0]}
            </span>
          </div>
          <button
            onClick={onSwitchUser}
            title="Switch user"
            className="opacity-40 hover:opacity-100 transition-opacity"
          >
            <LogOut size={12} color="#8b8ba8" />
          </button>
        </div>

        {/* Sync dot */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div className="relative">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: sync.dot, boxShadow: `0 0 5px ${sync.glow}` }}
            />
            {syncColor === "green" && (
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{ background: sync.dot }}
                animate={{ scale: [1, 2.5, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </div>
          <span className="text-xs" style={{ color: "#4a4a65" }}>{sync.label}</span>
        </div>
      </div>
    </motion.nav>
  );
}
