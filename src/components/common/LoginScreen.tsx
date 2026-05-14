import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Truck, ArrowRight, Lock, Eye, EyeOff } from "lucide-react";
import * as db from "../../lib/db";
import type { UserProfile } from "../../types";

interface Props {
  onLogin: (user: UserProfile) => void;
}

export const USERS: UserProfile[] = [
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

const PASSWORDS_KEY = "freight_crm_profile_passwords";

export function getProfilePasswords(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PASSWORDS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function setProfilePassword(userId: string, password: string) {
  const passwords = getProfilePasswords();
  if (password.trim()) {
    passwords[userId] = password.trim();
  } else {
    delete passwords[userId];
  }
  localStorage.setItem(PASSWORDS_KEY, JSON.stringify(passwords));
}

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
  const hasPassword = !!getProfilePasswords()[user.id];

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
      <div
        className="absolute top-0 left-6 right-6 h-px rounded-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${user.color}80, transparent)`,
          opacity: hovered ? 1 : 0.3,
          transition: "opacity 0.2s",
        }}
      />

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
      <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "#6b6b8a" }}>
        {hasPassword && <Lock size={10} />}
        {hasPassword ? "Password protected" : "Freight broker"}
      </p>

      <div
        className="flex items-center gap-1.5 mt-4 text-xs font-medium"
        style={{ color: hovered ? user.color : "#4a4a65", transition: "color 0.2s" }}
      >
        <span>{hasPassword ? "Enter password" : "Continue"}</span>
        <ArrowRight size={12} />
      </div>
    </motion.button>
  );
}

function PasswordPrompt({
  user,
  onSuccess,
  onCancel,
}: {
  user: UserProfile;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [input, setInput] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(false);

  const attempt = () => {
    const passwords = getProfilePasswords();
    if (input === passwords[user.id]) {
      onSuccess();
    } else {
      setError(true);
      setInput("");
      setTimeout(() => setError(false), 1500);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center gap-5"
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold text-white"
          style={{
            background: `linear-gradient(135deg, ${user.color}, ${user.color}99)`,
            boxShadow: `0 8px 24px ${user.color}40`,
          }}
        >
          {user.initials}
        </div>
        <p className="text-sm font-medium" style={{ color: "#f0f0f5" }}>{user.display_name}</p>
      </div>

      <div className="flex flex-col gap-2 w-64">
        <div className="relative">
          <input
            autoFocus
            type={showPw ? "text" : "password"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") attempt(); if (e.key === "Escape") onCancel(); }}
            placeholder="Password"
            className="w-full h-10 px-3 pr-10 text-sm rounded-xl outline-none transition-all"
            style={{
              background: error ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.06)",
              border: error ? "1px solid rgba(239,68,68,0.5)" : "1px solid rgba(255,255,255,0.1)",
              color: "#f0f0f5",
            }}
          />
          <button
            onClick={() => setShowPw(!showPw)}
            className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-70 transition-opacity"
          >
            {showPw ? <EyeOff size={14} color="#8b8ba8" /> : <Eye size={14} color="#8b8ba8" />}
          </button>
        </div>

        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs text-center"
            style={{ color: "#ef4444" }}
          >
            Incorrect password
          </motion.p>
        )}

        <button
          onClick={attempt}
          disabled={!input}
          className="h-10 rounded-xl text-sm font-medium disabled:opacity-40 transition-opacity"
          style={{
            background: `linear-gradient(135deg, ${user.color}, ${user.color}cc)`,
            color: "#fff",
          }}
        >
          Unlock
        </button>

        <button
          onClick={onCancel}
          className="text-xs py-1 opacity-40 hover:opacity-70 transition-opacity"
          style={{ color: "#8b8ba8" }}
        >
          ← Back
        </button>
      </div>
    </motion.div>
  );
}

export function LoginScreen({ onLogin }: Props) {
  const [loading, setLoading] = useState(false);
  const [pendingUser, setPendingUser] = useState<UserProfile | null>(null);

  const handleSelect = async (user: UserProfile) => {
    const passwords = getProfilePasswords();
    if (passwords[user.id]) {
      setPendingUser(user);
    } else {
      await doLogin(user);
    }
  };

  const doLogin = async (user: UserProfile) => {
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
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative flex flex-col items-center gap-10">
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
              {pendingUser ? "Enter your password" : "Who's working today?"}
            </p>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {pendingUser ? (
            <PasswordPrompt
              key="password"
              user={pendingUser}
              onSuccess={() => doLogin(pendingUser)}
              onCancel={() => setPendingUser(null)}
            />
          ) : (
            <motion.div
              key="cards"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex gap-4"
            >
              {USERS.map((user, i) => (
                <ProfileCard
                  key={user.id}
                  user={user}
                  onSelect={() => handleSelect(user)}
                  delay={0.15 + i * 0.1}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

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
