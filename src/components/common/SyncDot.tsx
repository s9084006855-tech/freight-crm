import { useSyncStore } from "../../store/sync";
import type { SyncStatusColor } from "../../types";

type DotColor = SyncStatusColor | "gray";

const DOT_COLORS: Record<DotColor, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-400",
  red: "bg-red-500",
  gray: "bg-zinc-500",
};

const LABELS: Record<DotColor, string> = {
  green: "Synced",
  yellow: "Sync pending",
  red: "Sync error",
  gray: "No sync",
};

export function SyncDot() {
  const syncStatus = useSyncStore((s) => s.status);
  const color: DotColor = syncStatus?.status ?? "gray";

  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-500" title={LABELS[color]}>
      <span className={`w-2 h-2 rounded-full ${DOT_COLORS[color]}`} />
      <span>{LABELS[color]}</span>
    </div>
  );
}
