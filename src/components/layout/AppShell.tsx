import { type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "./CommandPalette";
import { ToastStack } from "../common/Toast";
import type { UserProfile } from "../../types";

interface Props {
  children: ReactNode;
  activeUser: UserProfile;
  onSwitchUser: () => void;
}

export function AppShell({ children, activeUser, onSwitchUser }: Props) {
  return (
    <div
      className="relative flex h-screen overflow-hidden"
      style={{ background: "#05050a" }}
    >
      {/* Animated background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />

      {/* Content */}
      <div className="relative flex w-full h-full">
        <Sidebar activeUser={activeUser} onSwitchUser={onSwitchUser} />
        <div className="flex-1 flex flex-col min-w-0">
          <main className="flex-1 overflow-hidden">{children}</main>
          <StatusBar />
        </div>
      </div>

      <CommandPalette />
      <ToastStack />
    </div>
  );
}
