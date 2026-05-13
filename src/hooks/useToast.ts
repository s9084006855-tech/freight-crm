import { useUIStore } from "../store/ui";

export function useToast() {
  const pushToast = useUIStore((s) => s.pushToast);
  return {
    success: (msg: string) => pushToast(msg, "success"),
    error: (msg: string) => pushToast(msg, "error", 5000),
    info: (msg: string) => pushToast(msg, "info"),
  };
}
