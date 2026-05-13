import { useEffect } from "react";

type Key = string; // e.g. "k", "Escape", "ArrowDown"

interface ShortcutOptions {
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  preventDefault?: boolean;
}

export function useKeyboard(
  key: Key,
  handler: (e: KeyboardEvent) => void,
  options: ShortcutOptions = {},
  deps: unknown[] = []
): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (options.meta !== undefined && e.metaKey !== options.meta) return;
      if (options.ctrl !== undefined && e.ctrlKey !== options.ctrl) return;
      if (options.shift !== undefined && e.shiftKey !== options.shift) return;
      if (options.alt !== undefined && e.altKey !== options.alt) return;
      if (e.key !== key) return;

      // Don't fire when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (options.preventDefault !== false) e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useGlobalKeyboard(
  key: Key,
  handler: (e: KeyboardEvent) => void,
  options: ShortcutOptions = {},
  deps: unknown[] = []
): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (options.meta !== undefined && e.metaKey !== options.meta) return;
      if (options.ctrl !== undefined && e.ctrlKey !== options.ctrl) return;
      if (options.shift !== undefined && e.shiftKey !== options.shift) return;
      if (options.alt !== undefined && e.altKey !== options.alt) return;
      if (e.key !== key) return;
      if (options.preventDefault !== false) e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
