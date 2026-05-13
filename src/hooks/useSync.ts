import { useEffect } from "react";
import { useSyncStore } from "../store/sync";

export function useSync(pollIntervalMs = 30_000) {
  const store = useSyncStore();

  useEffect(() => {
    const stop = store.startPolling(pollIntervalMs);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return store;
}
