import { useUIStore, type Toast } from "../../store/ui";

const ICONS: Record<Toast["type"], string> = {
  success: "✓",
  error: "✕",
  info: "·",
};

const COLORS: Record<Toast["type"], string> = {
  success: "border-green-700 text-green-300",
  error: "border-red-700 text-red-300",
  info: "border-zinc-700 text-zinc-300",
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUIStore((s) => s.dismissToast);
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded border bg-zinc-900 text-sm font-mono shadow-lg ${COLORS[toast.type]}`}
      onClick={() => dismiss(toast.id)}
    >
      <span>{ICONS[toast.type]}</span>
      <span>{toast.message}</span>
    </div>
  );
}

export function ToastStack() {
  const toasts = useUIStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
