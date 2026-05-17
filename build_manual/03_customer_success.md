# Unit 3 — Customer Success

## What you're building

A "Stale shippers" view that surfaces every shipper you haven't talked to in N days (configurable; default 14). A weekly check-in template generator that uses Claude to draft a short, useful, non-pushy message tailored to each stale shipper based on their last activity and load history. A retention dashboard widget showing your top-20 repeat shippers and how recently each one was contacted. None of this is sexy. All of it compounds.

---

## Prerequisites

- [x] Units 1 + 2 complete — `loads`, `contacts.relationship_state`, `pipeline_cards` all exist
- [x] You have at least 5 contacts in `relationship_state = 'active'` (so the stale view has something to show)
- [x] Anthropic API key saved (for the weekly check-in generator)
- [x] On a branch: `git checkout -b feature/unit-3-customer-success`

---

## Step-by-step build

### Step 1: Add `follow_up_after_days` setting + default

**File to modify:** none for schema — uses existing `app_settings` k/v table.

**Action:** Set a default at app boot. In `src-tauri/src/lib.rs`, after `app.manage(state);` and the auto-reconnect spawn, add a fire-and-forget task that seeds the setting if missing:

```rust
let app_handle = app.app_handle().clone();
tauri::async_runtime::spawn(async move {
    // Wait a beat for auto-reconnect to land the DB
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    if let Some(state) = app_handle.try_state::<AppState>() {
        if let Ok(conn) = state.conn() {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('follow_up_after_days', '14')",
                (),
            ).await;
            let _ = conn.execute(
                "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('stale_view_min_loads', '1')",
                (),
            ).await;
        }
    }
});
```

**Decision: default threshold.**
- **(A) 7 days** — aggressive, good for hot/high-volume shippers
- **(B) 14 days** — moderate, recommended for produce where lanes repeat every 1–3 weeks
- **(C) 21 days** — passive, for low-touch enterprise shippers

**Recommendation:** B. Adjustable per-user in Settings (next step).

**Verify:** Restart, query `SELECT * FROM app_settings WHERE key = 'follow_up_after_days'` returns one row.

---

### Step 2: Stale shippers query in Rust

**File to create:** `src-tauri/src/commands/retention.rs`

```rust
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct StaleShipper {
    pub contact_id: i64,
    pub company_name: String,
    pub state: Option<String>,
    pub total_loads: i64,
    pub last_contacted_at: Option<i64>,
    pub days_since_contact: i64,
    pub last_load_consignee: Option<String>,
    pub last_load_commodity: Option<String>,
    pub primary_person_name: Option<String>,
    pub primary_person_phone: Option<String>,
}

#[tauri::command]
pub async fn get_stale_shippers(
    state: State<'_, AppState>,
    days: Option<i64>,
    min_loads: Option<i64>,
) -> Result<Vec<StaleShipper>, String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();

    // Read defaults from app_settings if caller didn't override
    let days = days.unwrap_or(read_setting_i64(&conn, "follow_up_after_days").await.unwrap_or(14));
    let min_loads = min_loads.unwrap_or(read_setting_i64(&conn, "stale_view_min_loads").await.unwrap_or(1));
    let cutoff = now - days * 86400;

    let mut rows = conn.query(
        "SELECT c.id, c.company_name, c.state, c.total_loads, c.last_contacted_at,
                (SELECT consignee_name FROM loads
                  WHERE shipper_contact_id = c.id
                  ORDER BY COALESCE(pickup_date, created_at) DESC LIMIT 1) AS last_consignee,
                (SELECT commodity FROM loads
                  WHERE shipper_contact_id = c.id
                  ORDER BY COALESCE(pickup_date, created_at) DESC LIMIT 1) AS last_commodity,
                (SELECT name FROM contact_people WHERE contact_id = c.id ORDER BY is_primary DESC LIMIT 1) AS person_name,
                (SELECT phone FROM contact_people WHERE contact_id = c.id ORDER BY is_primary DESC LIMIT 1) AS person_phone
         FROM contacts c
         WHERE c.status != 'deleted'
           AND c.relationship_state IN ('active', 'dormant')
           AND c.total_loads >= ?1
           AND (c.last_contacted_at IS NULL OR c.last_contacted_at < ?2)
         ORDER BY c.last_contacted_at ASC NULLS FIRST
         LIMIT 200",
        libsql::params![min_loads, cutoff],
    ).await.map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        let last: Option<i64> = row.get::<Option<i64>>(4).ok().flatten();
        result.push(StaleShipper {
            contact_id: row.get::<i64>(0).map_err(|e| e.to_string())?,
            company_name: row.get::<String>(1).map_err(|e| e.to_string())?,
            state: row.get::<Option<String>>(2).ok().flatten(),
            total_loads: row.get::<i64>(3).ok().unwrap_or(0),
            last_contacted_at: last,
            days_since_contact: last.map(|t| (now - t) / 86400).unwrap_or(999),
            last_load_consignee: row.get::<Option<String>>(5).ok().flatten(),
            last_load_commodity: row.get::<Option<String>>(6).ok().flatten(),
            primary_person_name: row.get::<Option<String>>(7).ok().flatten(),
            primary_person_phone: row.get::<Option<String>>(8).ok().flatten(),
        });
    }
    Ok(result)
}

async fn read_setting_i64(conn: &libsql::Connection, key: &str) -> Option<i64> {
    let mut r = conn.query(
        "SELECT value FROM app_settings WHERE key = ?1",
        libsql::params![key],
    ).await.ok()?;
    let row = r.next().await.ok()??;
    row.get::<String>(0).ok().and_then(|s| s.parse::<i64>().ok())
}
```

Register in `mod.rs` + `lib.rs`.

---

### Step 3: TypeScript types + db.ts wrapper

**File to modify:** `src/types/index.ts`

```typescript
export interface StaleShipper {
  contact_id: number;
  company_name: string;
  state?: string;
  total_loads: number;
  last_contacted_at?: number;
  days_since_contact: number;
  last_load_consignee?: string;
  last_load_commodity?: string;
  primary_person_name?: string;
  primary_person_phone?: string;
}
```

**File to modify:** `src/lib/db.ts`

```typescript
export const getStaleShippers = (days?: number, minLoads?: number) =>
  invoke<StaleShipper[]>("get_stale_shippers", { days, minLoads });
```

---

### Step 4: Stale shippers view

**File to create:** `src/views/RetentionView.tsx`

```tsx
import { useState, useEffect } from "react";
import * as db from "../lib/db";
import type { StaleShipper } from "../types";
import { useToast } from "../hooks/useToast";
import { humanError } from "../lib/errors";
import { useUIStore } from "../store/ui";
import { useContactsStore } from "../store/contacts";

export function RetentionView() {
  const [stale, setStale] = useState<StaleShipper[]>([]);
  const [daysFilter, setDaysFilter] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const openQuickCall = useUIStore((s) => s.openQuickCall);
  const setView = useUIStore((s) => s.setView);
  const selectContact = useContactsStore((s) => s.selectContact);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await db.getStaleShippers(daysFilter);
      setStale(r);
    } catch (e) { toast.error(humanError(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, [daysFilter]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Stale shippers</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Active shippers you haven't talked to recently. Call them today.</p>
        </div>
        <div className="flex gap-1">
          {[7, 14, 21, 30].map((d) => (
            <button key={d} onClick={() => setDaysFilter(d)}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                daysFilter === d ? "text-zinc-100 bg-zinc-700" : "text-zinc-500 hover:text-zinc-300"
              }`}>
              {d}d+
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="px-6 py-6 text-xs text-zinc-600 font-mono">Loading…</p>}
        {!loading && stale.length === 0 && (
          <p className="px-6 py-12 text-xs text-zinc-600 font-mono text-center">
            No stale shippers. You're caught up.
          </p>
        )}
        <div className="divide-y divide-zinc-900">
          {stale.map((s) => (
            <div key={s.contact_id} className="px-6 py-3 hover:bg-zinc-900/50">
              <div className="flex items-baseline justify-between">
                <button onClick={() => { selectContact(s.contact_id); setView("contact-detail"); }}
                  className="text-sm font-medium text-zinc-100 hover:text-indigo-300">
                  {s.company_name}
                </button>
                <span className={`text-xs font-mono ${s.days_since_contact > 30 ? "text-red-400" : s.days_since_contact > 14 ? "text-yellow-400" : "text-zinc-500"}`}>
                  {s.days_since_contact}d ago
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs font-mono text-zinc-500">
                <span>{s.state ?? "—"}</span>
                <span>·</span>
                <span>{s.total_loads} loads</span>
                {s.last_load_commodity && <><span>·</span><span>{s.last_load_commodity}</span></>}
                {s.primary_person_name && <><span>·</span><span className="text-zinc-400">{s.primary_person_name}</span></>}
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => openQuickCall(s.contact_id)}
                  className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded">
                  Log call →
                </button>
                <button
                  className="text-xs px-2.5 py-1 bg-indigo-700 hover:bg-indigo-600 text-white rounded"
                  onClick={() => alert("Step 6 — wire to check_in_draft command")}>
                  ✨ Draft check-in
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

Add to sidebar (label: "Retention", shortcut `⌘6`) and router (`case "retention"`). Add `"retention"` to the `ViewName` union.

**Verify:** `⌘6` opens, list shows shippers with days-since badges color-coded yellow/red, click "Log call →" → QuickCallModal opens for that shipper.

---

### Step 5: Settings UI for `follow_up_after_days`

**File to modify:** `src/views/SettingsView.tsx`

Add a section above "Anthropic API key":

```tsx
{/* Retention settings */}
<section>
  <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Retention</h2>
  <div className="flex gap-2 items-center">
    <label className="text-xs text-zinc-500 font-mono w-40">Follow-up after (days):</label>
    <input type="number" min="1" max="180"
      value={settings.follow_up_after_days ?? "14"}
      onChange={(e) => setSettings((s) => ({ ...s, follow_up_after_days: e.target.value }))}
      className="w-20 h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
    <button onClick={() => saveSetting("follow_up_after_days", settings.follow_up_after_days ?? "14")}
      className="px-3 py-1.5 text-xs font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded">
      Save
    </button>
  </div>
  <p className="text-xs text-zinc-600 mt-2">
    Shippers in <code>active</code> or <code>dormant</code> state with no contact in this many days
    appear in the Retention view (⌘6).
  </p>
</section>
```

---

### Step 6: Claude check-in draft generator

**File to add a command in:** `src-tauri/src/commands/retention.rs`

```rust
use serde_json::json;

#[tauri::command]
pub async fn draft_check_in(
    state: State<'_, AppState>,
    contact_id: i64,
    broker_name: Option<String>,
) -> Result<String, String> {
    let api_key = crate::commands::keychain::get_raw_api_key()
        .ok_or("No API key configured")?;
    let conn = state.conn()?;

    // Pull the shipper context
    let mut rows = conn.query(
        "SELECT c.company_name, c.state, c.total_loads,
                (SELECT commodity FROM loads WHERE shipper_contact_id = c.id ORDER BY COALESCE(pickup_date, created_at) DESC LIMIT 1),
                (SELECT consignee_name FROM loads WHERE shipper_contact_id = c.id ORDER BY COALESCE(pickup_date, created_at) DESC LIMIT 1),
                (SELECT name FROM contact_people WHERE contact_id = c.id ORDER BY is_primary DESC LIMIT 1),
                (SELECT notes FROM activities WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1),
                c.last_contacted_at
         FROM contacts c WHERE c.id = ?1",
        libsql::params![contact_id],
    ).await.map_err(|e| e.to_string())?;
    let r = rows.next().await.map_err(|e| e.to_string())?.ok_or("Contact not found")?;

    let context = json!({
        "company": r.get::<String>(0).map_err(|e| e.to_string())?,
        "state": r.get::<Option<String>>(1).ok().flatten(),
        "total_loads": r.get::<i64>(2).ok().unwrap_or(0),
        "last_commodity": r.get::<Option<String>>(3).ok().flatten(),
        "last_consignee": r.get::<Option<String>>(4).ok().flatten(),
        "primary_contact": r.get::<Option<String>>(5).ok().flatten(),
        "last_call_notes": r.get::<Option<String>>(6).ok().flatten(),
        "broker_name": broker_name.unwrap_or_else(|| "Francisco".into()),
    });

    let body = json!({
        "model": "claude-sonnet-4-6",
        "max_tokens": 600,
        "system": [{
            "type": "text",
            "text": "You draft short, warm, non-pushy retention messages from a produce freight broker (AFUO, last-minute emergency reefer coverage) to a shipper he already works with. The message MUST be: under 80 words, friendly but professional, reference one specific thing about their last load if available, and end with an offer of value — NOT a question that demands a response. No 'just checking in', no 'circling back', no exclamation points, no emojis. Output plain text only — no greeting line if the broker name is signed at the end, no headers, no markdown.",
            "cache_control": { "type": "ephemeral" }
        }],
        "messages": [{
            "role": "user",
            "content": format!("Draft a check-in for this shipper:\n\n{}", serde_json::to_string_pretty(&context).unwrap())
        }]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = resp.text().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

    let draft = json["content"].as_array()
        .and_then(|arr| arr.iter().find(|b| b["type"] == "text"))
        .and_then(|b| b["text"].as_str())
        .ok_or_else(|| format!("No draft returned: {}", text))?
        .trim()
        .to_string();

    Ok(draft)
}
```

Register in `lib.rs`. Add the TS wrapper:

```typescript
export const draftCheckIn = (contactId: number, brokerName?: string) =>
  invoke<string>("draft_check_in", { contactId, brokerName });
```

---

### Step 7: Wire the "✨ Draft check-in" button

**File to modify:** `src/views/RetentionView.tsx`

Replace the `alert(…)` placeholder with a modal:

```tsx
const [draftFor, setDraftFor] = useState<{ contactId: number; name: string } | null>(null);
const [draftText, setDraftText] = useState("");
const [drafting, setDrafting] = useState(false);

const handleDraft = async (s: StaleShipper) => {
  setDraftFor({ contactId: s.contact_id, name: s.company_name });
  setDraftText("");
  setDrafting(true);
  try {
    const text = await db.draftCheckIn(s.contact_id, activeUserDisplayName);
    setDraftText(text);
  } catch (e) {
    toast.error(humanError(e));
    setDraftFor(null);
  } finally {
    setDrafting(false);
  }
};
```

Then a modal showing the draft with **Copy**, **Edit**, **Regenerate**, and **Mark as sent** buttons. "Mark as sent" calls `log_activity` with type=`note`, outcome=`Email sent`, notes=the draft text.

(`activeUserDisplayName` comes from the AppShell's activeUser prop or via a hook.)

---

### Step 8: Dashboard widget — Top 20 repeat shippers

**File to create:** `src/components/dashboard/TopShippersWidget.tsx`

```tsx
import { useState, useEffect } from "react";
import * as db from "../../lib/db";
import { useUIStore } from "../../store/ui";
import { useContactsStore } from "../../store/contacts";

interface TopShipper {
  id: number;
  company_name: string;
  total_loads: number;
  last_contacted_at?: number;
}

export function TopShippersWidget() {
  const [top, setTop] = useState<TopShipper[]>([]);
  const setView = useUIStore((s) => s.setView);
  const select = useContactsStore((s) => s.selectContact);

  useEffect(() => {
    db.getContacts({
      sort_by: "priority", // reuse priority sort; or add a new "total_loads" sort_by
      limit: 20,
      offset: 0,
      status: "active",
    }).then((rows) => {
      // Filter to ones with loads, sort by total_loads desc (client-side fallback)
      // NOTE: better — add sort_by: "total_loads" to ContactFilter, see step 9
      const filtered = rows
        .filter((r) => (r as any).total_loads > 0)
        .sort((a, b) => ((b as any).total_loads ?? 0) - ((a as any).total_loads ?? 0))
        .slice(0, 20);
      setTop(filtered as TopShipper[]);
    }).catch(() => {});
  }, []);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-3">Top repeat shippers</h3>
      <div className="space-y-1.5">
        {top.length === 0 && <p className="text-xs text-zinc-600 font-mono">No repeat shippers yet.</p>}
        {top.map((s) => (
          <button key={s.id} onClick={() => { select(s.id); setView("contact-detail"); }}
            className="w-full text-left flex justify-between items-baseline text-xs font-mono py-1 hover:bg-zinc-800/50 px-2 -mx-2 rounded">
            <span className="text-zinc-200 truncate">{s.company_name}</span>
            <span className="text-zinc-500">{s.total_loads} loads</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

**File to modify:** `src/views/DashboardView.tsx`

Add `<TopShippersWidget />` next to the existing StatsRow / FollowUpQueue.

---

### Step 9: Add `total_loads` sort to ContactFilter (optional but cleaner)

The widget filters client-side which doesn't scale. To make it real:

**File to modify:** `src-tauri/src/commands/contacts.rs`

In `get_contacts`, add to the `sort_col` match:

```rust
Some("total_loads") => "c.total_loads DESC, c.company_name_search",
```

**File to modify:** `src/types/index.ts`

```typescript
sort_by?: "name" | "last_contacted" | "state" | "priority" | "total_loads";
```

Then in `TopShippersWidget`, change `sort_by: "priority"` → `sort_by: "total_loads"`.

---

## How to test the whole unit

1. `⌘6` opens Retention. Shippers you haven't called in 14+ days appear.
2. Click the `7d+` chip — list narrows.
3. Click `30d+` — list narrows more.
4. Click a shipper's name → opens their contact detail.
5. Back to Retention (`⌘6`). Click **Log call →** on one shipper. QuickCallModal opens. Log a call. Toast. The shipper disappears from the stale list (because `last_contacted_at` is now today).
6. Click **✨ Draft check-in** on another shipper. Modal opens, "Drafting…" → returns ~70 words referencing the last load commodity and consignee.
7. Click **Copy** → paste into a text editor → looks like a real message you'd send.
8. Click **Regenerate** → new variant. Different but still on-topic.
9. Click **Mark as sent**. An activity row gets logged with the draft body in notes. Toast.
10. Press `⌘,` Settings → change "Follow-up after" to 7 days. Save.
11. `⌘6` Retention → list grows (more shippers are now considered "stale").
12. Press `⌘1` Dashboard. Top repeat shippers widget shows your top-20 by total_loads.

If all 12 steps work, Unit 3 is done.

---

## What to tell Claude Code to build this for me

```text
Execute build_manual/03_customer_success.md from start to finish. Units 1 and 2 must already be merged.

Constraints:
- Stack is fixed: Tauri 2 + React 19 + Turso/libSQL.
- All Tauri commands registered in src-tauri/src/lib.rs invoke_handler.
- The Claude API call in step 6 uses claude-sonnet-4-6, max_tokens=600, prompt caching on the system prompt.
- The draft generator MUST output plain text only — strict on the system prompt.
- Step 9 is REQUIRED, not optional — fix the client-side filtering hack before declaring Unit 3 done.
- Use TodoWrite to mark each step.
- Run the 12-step walkthrough. Report passes/fails. Stop before Unit 4.
```

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| "No stale shippers" on a fresh DB | All your contacts have `relationship_state = 'prospect'` | Unit 1 step 5 should have promoted shippers to `active` when they got their first load. If you imported but never logged loads, manually update: `UPDATE contacts SET relationship_state='active' WHERE total_loads > 0`. |
| Draft check-in is too long / robotic | Prompt isn't strict enough | Tighten the system prompt: add "Output MUST be under 60 words. No greeting. No question at the end." |
| Draft references a commodity that doesn't exist | Claude hallucinated when the load context was sparse | Add `"Do not invent details. If a field is null in the context, ignore it."` to the system prompt. |
| Stale view shows declined / do-not-call shippers | Query filter wrong | Confirm the query filters on `relationship_state IN ('active', 'dormant')`. |
| Settings save doesn't update Retention threshold | Cache. Retention view loads stale once on mount | Either re-run `getStaleShippers` on focus, or live-bind to the setting via a Zustand store. Simplest: refresh button on the view. |
| Top shippers widget shows shippers with 0 loads | Step 9 not done | Add the `total_loads` sort and filter on server-side. |
