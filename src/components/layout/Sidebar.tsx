import { useUIStore } from "../../store/ui";
import { SyncDot } from "../common/SyncDot";
import type { ViewName } from "../../types";

interface NavItem {
  view: ViewName;
  label: string;
  shortcut: string;
}

const NAV: NavItem[] = [
  { view: "dashboard", label: "Dashboard", shortcut: "1" },
  { view: "contacts", label: "Contacts", shortcut: "2" },
  { view: "import", label: "Import", shortcut: "3" },
  { view: "settings", label: "Settings", shortcut: "," },
];

export function Sidebar() {
  const activeView = useUIStore((s) => s.activeView);
  const setView = useUIStore((s) => s.setView);

  return (
    <nav className="w-48 shrink-0 flex flex-col bg-zinc-950 border-r border-zinc-800 h-full">
      <div className="px-4 py-5">
        <span className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
          Freight CRM
        </span>
      </div>

      <div className="flex-1 px-2 space-y-0.5">
        {NAV.map((item) => (
          <button
            key={item.view}
            onClick={() => setView(item.view)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded text-sm font-mono transition-colors ${
              activeView === item.view
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>{item.label}</span>
            <span className="text-xs text-zinc-600">⌘{item.shortcut}</span>
          </button>
        ))}
      </div>

      <div className="px-4 py-4 border-t border-zinc-800">
        <SyncDot />
      </div>
    </nav>
  );
}
