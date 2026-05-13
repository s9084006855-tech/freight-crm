import { create } from "zustand";
import type { ViewName } from "../types";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  duration?: number;
}

interface UIState {
  activeView: ViewName;
  commandPaletteOpen: boolean;
  diagnosticsOpen: boolean;
  quickCallContactId: number | null;
  toasts: Toast[];
  importSessionId: number | null;

  setView: (view: ViewName) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  openDiagnostics: () => void;
  closeDiagnostics: () => void;
  openQuickCall: (contactId: number) => void;
  closeQuickCall: () => void;
  pushToast: (message: string, type?: Toast["type"], duration?: number) => void;
  dismissToast: (id: string) => void;
  setImportSession: (id: number | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeView: "dashboard",
  commandPaletteOpen: false,
  diagnosticsOpen: false,
  quickCallContactId: null,
  toasts: [],
  importSessionId: null,

  setView: (view) => set({ activeView: view }),

  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),

  openDiagnostics: () => set({ diagnosticsOpen: true }),
  closeDiagnostics: () => set({ diagnosticsOpen: false }),

  openQuickCall: (contactId) => set({ quickCallContactId: contactId }),
  closeQuickCall: () => set({ quickCallContactId: null }),

  pushToast: (message, type = "info", duration = 3500) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration }] }));
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setImportSession: (id) => set({ importSessionId: id }),
}));
