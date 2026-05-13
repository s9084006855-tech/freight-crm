import { create } from "zustand";
import type { SyncStatus } from "../types";
import * as db from "../lib/db";
import { logError } from "../lib/errors";

interface SyncState {
  status: SyncStatus | null;
  polling: boolean;
  lastChecked: number | null;

  fetchStatus: () => Promise<void>;
  refresh: () => Promise<void>;
  forceUnlock: () => Promise<void>;
  startPolling: (intervalMs?: number) => () => void;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  status: null,
  polling: false,
  lastChecked: null,

  fetchStatus: async () => {
    try {
      const status = await db.getSyncStatus();
      set({ status, lastChecked: Date.now() });
    } catch (e) {
      await logError(String(e), "sync/fetchStatus");
    }
  },

  refresh: async () => {
    try {
      await db.refreshFromSync();
      await get().fetchStatus();
    } catch (e) {
      await logError(String(e), "sync/refresh");
      throw e;
    }
  },

  forceUnlock: async () => {
    try {
      await db.forceUnlock();
      await get().fetchStatus();
    } catch (e) {
      await logError(String(e), "sync/forceUnlock");
      throw e;
    }
  },

  startPolling: (intervalMs = 30_000) => {
    if (get().polling) return () => {};
    set({ polling: true });
    get().fetchStatus();
    const id = setInterval(() => get().fetchStatus(), intervalMs);
    return () => {
      clearInterval(id);
      set({ polling: false });
    };
  },
}));
