import { useState } from "react";
import { motion } from "framer-motion";
import { Truck, ArrowRight } from "lucide-react";
import * as db from "../../lib/db";
import type { UserProfile } from "../../types";

interface Props {
  onLogin: (user: UserProfile) => void;
}

const USERS: UserProfile[] = [
  {
    id: "francisco",
    display_name: "Francisco Pelaez",
    initials: "FP",
    color: "#6366f1",
  },
  {
    id: "jack",
    display_name: "Jack Scopetta",
    initials: "JS",
    color: "#06b6d4",
  },
];

function ProfileCard({
  user,
  onSelect,
  delay,
}: {
  user: UserProfile;
  onSelect: () => void;
  delay: number;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.button
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ scale: 1.03, y: -4 }}
      whileTap={{ scale: 0.97 }}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative w-52 rounded-2xl p-6 text-left cursor-pointer overflow-hidden"
      style={{
        background: hovered
          ? `rgba(${user.color === "#6366f1" ? "99,102,241" : "6,182,212"},0.1)`
          : "rgba(255,255,255,0.03)",
        border: hovered
          ? `1px solid ${user.color}60`
          : "1px solid rgba(255,255,255,0.07)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow: hovered
          ? `0 20px 40px ${user.color}20, 0 0 0 1px ${user.color}30`
          : "0 4px 20px rgba(0,0,0,0.3)",
        transition: "all 0.2s ease",
      }}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-6 right-6 h-px rounded-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${user.color}80, transparent)`,
          opacity: hovered ? 1 : 0.3,
          transition: "opacity 0.2s",
        }}
      />

      {/* Avatar */}
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold text-white mb-4"
        style={{
          background: `linear-gradient(135deg, ${user.color}, ${user.color}99)`,
          boxShadow: `0 8px 24px ${user.color}40`,
        }}
      >
        {user.initials}
      </div>

      <p className="text-base font-semibold" style={{ color: "#f0f0f5" }}>
        {user.display_name}
      </p>
      <p className="text-xs mt-1" style={{ color: "#6b6b8a" }}>
        Freight broker
      </p>

      <div
        className="flex items-center gap-1.5 mt-4 text-xs font-medium"
        style={{ color: hovered ? user.color : "#4a4a65", transition: "color 0.2s" }}
      >
        <span>Continue</span>
        <ArrowRight size={12} />
      </div>
    </motion.button>
  );
}

export function LoginScreen({ onLogin }: Props) {
  const [loading, setLoading] = useState(false);

  const handleSelect = async (user: UserProfile) => {
    setLoading(true);
    try {
      await db.setActiveUser(user.id);
      onLogin(user);
    } catch {
      onLogin(user);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative flex h-screen flex-col items-center justify-center overflow-hidden"
      style={{ background: "#05050a" }}
    >
      {/* Background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      {/* Grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative flex flex-col items-center gap-10">
        {/* Logo */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="flex flex-col items-center gap-3"
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              boxShadow: "0 8px 32px rgba(99,102,241,0.4)",
            }}
          >
            <Truck size={28} className="text-white" />
          </div>
          <div className="text-center">
            <h1
              className="text-2xl font-bold"
              style={{
                background: "linear-gradient(135deg, #f0f0f5, #8b8ba8)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Freight CRM
            </h1>
            <p className="text-sm mt-1" style={{ color: "#4a4a65" }}>
              Who's working today?
            </p>
          </div>
        </motion.div>

        {/* Profile cards */}
        <div className="flex gap-4">
          {USERS.map((user, i) => (
            <ProfileCard
              key={user.id}
              user={user}
              onSelect={() => handleSelect(user)}
              delay={0.15 + i * 0.1}
            />
          ))}
        </div>

        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2"
          >
            <motion.div
              className="w-4 h-4 rounded-full"
              style={{ border: "2px solid rgba(99,102,241,0.3)", borderTopColor: "#6366f1" }}
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
            />
            <span className="text-xs" style={{ color: "#4a4a65" }}>Loading…</span>
          </motion.div>
        )}
      </div>
    </div>
  );
}
