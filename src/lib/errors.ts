import { invoke } from "@tauri-apps/api/core";

export async function logError(
  message: string,
  context?: string,
  stack?: string
): Promise<void> {
  try {
    await invoke("log_error", { level: "error", context, message, stack });
  } catch {
    console.error("[log_error failed]", message);
  }
}

export async function logWarn(message: string, context?: string): Promise<void> {
  try {
    await invoke("log_error", { level: "warn", context, message, stack: null });
  } catch {
    console.warn("[log_warn failed]", message);
  }
}

export function humanError(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw instanceof Error) return raw.message;
  return "An unexpected error occurred.";
}
