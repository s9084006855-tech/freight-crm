import { type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "./CommandPalette";
import { ToastStack } from "../common/Toast";

interface Props {
  children: ReactNode;
}

export function AppShell({ children }: Props) {
  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-hidden">{children}</main>
        <StatusBar />
      </div>
      <CommandPalette />
      <ToastStack />
    </div>
  );
}
