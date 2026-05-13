import { useState, useEffect, useCallback } from "react";
import type { Activity, FollowUpItem } from "../types";
import * as db from "../lib/db";
import { logError } from "../lib/errors";

export function useActivities(contactId: number | null) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (contactId == null) return;
    setLoading(true);
    try {
      const data = await db.getActivities(contactId);
      setActivities(data);
    } catch (e) {
      await logError(String(e), "useActivities/fetch");
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { activities, loading, refresh: fetch };
}

export function useFollowUps() {
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);

  const fetch = useCallback(async () => {
    try {
      const data = await db.getFollowUps();
      setFollowUps(data);
    } catch (e) {
      await logError(String(e), "useFollowUps/fetch");
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const markDone = useCallback(async (id: number) => {
    await db.markFollowUpDone(id);
    await fetch();
  }, [fetch]);

  return { followUps, markDone, refresh: fetch };
}
