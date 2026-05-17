# Unit 2 — CRM (Pipeline + Rate Confirmations)

## What you're building

A configurable kanban pipeline (Lead → Qualified → Setup Packet → First Load Booked → Active → Dormant) where each shipper card shows its last activity, total loads, and a one-click action to log a call. Plus a rate confirmation generator that pulls per-shipper templates from a table and produces a clean PDF/text document populated from a load row.

---

## Prerequisites

- [x] Unit 1 complete — `loads` table exists, `contacts.relationship_state` column exists
- [x] `mc_number`, `dot_number`, `scac` set in `app_settings` (Settings UI will let you set them in step 7 of this unit)
- [x] You're on a branch: `git checkout -b feature/unit-2-crm`

---

## Step-by-step build

### Step 1: Add `pipeline_stages` and `pipeline_cards` tables (v4 migration)

**File to modify:** `src-tauri/src/db.rs`

```rust
async fn apply_v4(conn: &libsql::Connection) -> Result<(), libsql::Error> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS pipeline_stages (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL UNIQUE,
            sort_order   INTEGER NOT NULL,
            color        TEXT NOT NULL DEFAULT '#6366f1',
            is_terminal  INTEGER NOT NULL DEFAULT 0,
                -- 1 means cards that reach this stage are 'done' (won or lost)
            created_at   INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS pipeline_cards (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            contact_id   INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            stage_id     INTEGER NOT NULL REFERENCES pipeline_stages(id),
            sort_within  INTEGER NOT NULL DEFAULT 0,
            notes        TEXT,
            entered_stage_at INTEGER NOT NULL DEFAULT (unixepoch()),
            created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_card_stage   ON pipeline_cards(stage_id);
        CREATE INDEX IF NOT EXISTS idx_card_contact ON pipeline_cards(contact_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_card_unique ON pipeline_cards(contact_id);
    ").await?;

    // Seed the default stages — these match Francisco's actual workflow.
    // is_terminal=1 on 'Active' means cards in Active are 'closed-won' for pipeline metrics.
    conn.execute_batch("
        INSERT OR IGNORE INTO pipeline_stages (name, sort_order, color, is_terminal) VALUES
            ('Lead',              0, '#71717a', 0),
            ('Qualified',         1, '#3b82f6', 0),
            ('Setup Packet Sent', 2, '#a78bfa', 0),
            ('First Load Booked', 3, '#f59e0b', 0),
            ('Active',            4, '#22c55e', 1),
            ('Dormant',           5, '#525252', 1),
            ('Declined',          6, '#ef4444', 1);
    ").await?;
    Ok(())
}
```

Wire it up:
```rust
if current < 4 {
    apply_v4(conn).await?;
    conn.execute("INSERT INTO schema_migrations (version) VALUES (4)", ()).await?;
}
```

**Decision: stage names.** You picked these defaults. If you want different ones later, the UI in step 6 lets you rename/reorder/delete stages.

**Verify:** Restart. Query: `SELECT name, sort_order FROM pipeline_stages ORDER BY sort_order` — returns 7 rows.

---

### Step 2: Rust models for pipeline

**File to modify:** `src-tauri/src/models.rs`

```rust
// ── Pipeline ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PipelineStage {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
    pub color: String,
    pub is_terminal: bool,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PipelineCard {
    pub id: i64,
    pub contact_id: i64,
    pub stage_id: i64,
    pub sort_within: i64,
    pub notes: Option<String>,
    pub entered_stage_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
    // denormalized for display
    pub company_name: String,
    pub state: Option<String>,
    pub total_loads: i64,
    pub last_contacted_at: Option<i64>,
}
```

---

### Step 3: `pipeline.rs` commands

**File to create:** `src-tauri/src/commands/pipeline.rs`

```rust
use crate::{AppState, PipelineCard, PipelineStage};
use crate::db::last_insert_rowid;
use tauri::State;

#[tauri::command]
pub async fn get_pipeline_stages(state: State<'_, AppState>) -> Result<Vec<PipelineStage>, String> {
    let conn = state.conn()?;
    let mut rows = conn.query(
        "SELECT id, name, sort_order, color, is_terminal, created_at
         FROM pipeline_stages ORDER BY sort_order ASC",
        (),
    ).await.map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        result.push(PipelineStage {
            id: row.get::<i64>(0).map_err(|e| e.to_string())?,
            name: row.get::<String>(1).map_err(|e| e.to_string())?,
            sort_order: row.get::<i64>(2).map_err(|e| e.to_string())?,
            color: row.get::<String>(3).map_err(|e| e.to_string())?,
            is_terminal: row.get::<i64>(4).map_err(|e| e.to_string())? != 0,
            created_at: row.get::<i64>(5).map_err(|e| e.to_string())?,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn create_pipeline_stage(
    state: State<'_, AppState>,
    name: String,
    sort_order: i64,
    color: Option<String>,
    is_terminal: Option<bool>,
) -> Result<PipelineStage, String> {
    let conn = state.conn()?;
    conn.execute(
        "INSERT INTO pipeline_stages (name, sort_order, color, is_terminal) VALUES (?1, ?2, ?3, ?4)",
        libsql::params![name.clone(), sort_order, color.unwrap_or_else(|| "#6366f1".into()), is_terminal.unwrap_or(false) as i64],
    ).await.map_err(|e| e.to_string())?;
    let id = last_insert_rowid(&conn).await?;
    Ok(PipelineStage {
        id, name, sort_order,
        color: "#6366f1".into(),
        is_terminal: is_terminal.unwrap_or(false),
        created_at: chrono::Utc::now().timestamp(),
    })
}

#[tauri::command]
pub async fn delete_pipeline_stage(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    // Refuse to delete a stage that has cards
    let mut r = conn.query(
        "SELECT COUNT(*) FROM pipeline_cards WHERE stage_id = ?1",
        libsql::params![id],
    ).await.map_err(|e| e.to_string())?;
    let count: i64 = r.next().await.map_err(|e| e.to_string())?
        .and_then(|row| row.get::<i64>(0).ok()).unwrap_or(0);
    if count > 0 {
        return Err(format!("Cannot delete stage — {} cards still in it. Move them first.", count));
    }
    conn.execute("DELETE FROM pipeline_stages WHERE id = ?1", libsql::params![id])
        .await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_pipeline_cards(state: State<'_, AppState>) -> Result<Vec<PipelineCard>, String> {
    let conn = state.conn()?;
    let mut rows = conn.query(
        "SELECT pc.id, pc.contact_id, pc.stage_id, pc.sort_within, pc.notes,
                pc.entered_stage_at, pc.created_at, pc.updated_at,
                c.company_name, c.state, c.total_loads, c.last_contacted_at
         FROM pipeline_cards pc
         JOIN contacts c ON c.id = pc.contact_id
         WHERE c.status != 'deleted'
         ORDER BY pc.stage_id, pc.sort_within ASC",
        (),
    ).await.map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        result.push(PipelineCard {
            id: row.get::<i64>(0).map_err(|e| e.to_string())?,
            contact_id: row.get::<i64>(1).map_err(|e| e.to_string())?,
            stage_id: row.get::<i64>(2).map_err(|e| e.to_string())?,
            sort_within: row.get::<i64>(3).map_err(|e| e.to_string())?,
            notes: row.get::<Option<String>>(4).ok().flatten(),
            entered_stage_at: row.get::<i64>(5).map_err(|e| e.to_string())?,
            created_at: row.get::<i64>(6).map_err(|e| e.to_string())?,
            updated_at: row.get::<i64>(7).map_err(|e| e.to_string())?,
            company_name: row.get::<String>(8).map_err(|e| e.to_string())?,
            state: row.get::<Option<String>>(9).ok().flatten(),
            total_loads: row.get::<i64>(10).ok().unwrap_or(0),
            last_contacted_at: row.get::<Option<i64>>(11).ok().flatten(),
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn add_contact_to_pipeline(
    state: State<'_, AppState>,
    contact_id: i64,
    stage_id: i64,
) -> Result<PipelineCard, String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO pipeline_cards (contact_id, stage_id, entered_stage_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(contact_id) DO UPDATE SET stage_id = excluded.stage_id,
                                              entered_stage_at = excluded.entered_stage_at,
                                              updated_at = excluded.entered_stage_at",
        libsql::params![contact_id, stage_id, now],
    ).await.map_err(|e| e.to_string())?;
    let cards = get_pipeline_cards(state).await?;
    cards.into_iter().find(|c| c.contact_id == contact_id)
        .ok_or_else(|| "Failed to add card".into())
}

#[tauri::command]
pub async fn move_pipeline_card(
    state: State<'_, AppState>,
    card_id: i64,
    new_stage_id: i64,
    new_sort_within: i64,
) -> Result<(), String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE pipeline_cards SET stage_id = ?1, sort_within = ?2, entered_stage_at = ?3, updated_at = ?3 WHERE id = ?4",
        libsql::params![new_stage_id, new_sort_within, now, card_id],
    ).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn remove_pipeline_card(state: State<'_, AppState>, card_id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute("DELETE FROM pipeline_cards WHERE id = ?1", libsql::params![card_id])
        .await.map_err(|e| e.to_string())?;
    Ok(())
}
```

Register in `mod.rs` + `lib.rs` (same pattern as Unit 1 step 6).

---

### Step 4: TypeScript types + db.ts wrappers

**File to modify:** `src/types/index.ts`

```typescript
export interface PipelineStage {
  id: number;
  name: string;
  sort_order: number;
  color: string;
  is_terminal: boolean;
  created_at: number;
}

export interface PipelineCard {
  id: number;
  contact_id: number;
  stage_id: number;
  sort_within: number;
  notes?: string;
  entered_stage_at: number;
  created_at: number;
  updated_at: number;
  company_name: string;
  state?: string;
  total_loads: number;
  last_contacted_at?: number;
}
```

**File to modify:** `src/lib/db.ts`

```typescript
export const getPipelineStages = () =>
  invoke<PipelineStage[]>("get_pipeline_stages");

export const createPipelineStage = (name: string, sortOrder: number, color?: string, isTerminal?: boolean) =>
  invoke<PipelineStage>("create_pipeline_stage", { name, sortOrder, color, isTerminal });

export const deletePipelineStage = (id: number) =>
  invoke<void>("delete_pipeline_stage", { id });

export const getPipelineCards = () =>
  invoke<PipelineCard[]>("get_pipeline_cards");

export const addContactToPipeline = (contactId: number, stageId: number) =>
  invoke<PipelineCard>("add_contact_to_pipeline", { contactId, stageId });

export const movePipelineCard = (cardId: number, newStageId: number, newSortWithin: number) =>
  invoke<void>("move_pipeline_card", { cardId, newStageId, newSortWithin });

export const removePipelineCard = (cardId: number) =>
  invoke<void>("remove_pipeline_card", { cardId });
```

---

### Step 5: Kanban PipelineView with HTML5 drag-and-drop

**File to create:** `src/views/PipelineView.tsx`

```tsx
import { useState, useEffect } from "react";
import * as db from "../lib/db";
import type { PipelineCard, PipelineStage } from "../types";
import { useToast } from "../hooks/useToast";
import { humanError } from "../lib/errors";
import { useUIStore } from "../store/ui";

function daysSince(ts?: number) {
  if (!ts) return null;
  return Math.floor((Date.now() / 1000 - ts) / 86400);
}

export function PipelineView() {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [dragId, setDragId] = useState<number | null>(null);
  const toast = useToast();
  const setView = useUIStore((s) => s.setView);

  const reload = async () => {
    const [s, c] = await Promise.all([db.getPipelineStages(), db.getPipelineCards()]);
    setStages(s);
    setCards(c);
  };

  useEffect(() => { reload().catch((e) => toast.error(humanError(e))); }, []);

  const onDrop = async (stageId: number) => {
    if (dragId == null) return;
    const newSort = cards.filter((c) => c.stage_id === stageId).length;
    try {
      await db.movePipelineCard(dragId, stageId, newSort);
      await reload();
    } catch (e) {
      toast.error(humanError(e));
    }
    setDragId(null);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <h2 className="text-sm font-semibold text-zinc-100">Pipeline</h2>
        <button onClick={() => setView("settings")}
          className="text-xs text-zinc-500 hover:text-zinc-300 font-mono">
          Configure stages →
        </button>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div className="flex gap-3 h-full">
          {stages.map((stage) => {
            const stageCards = cards.filter((c) => c.stage_id === stage.id);
            return (
              <div key={stage.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(stage.id)}
                className="w-72 shrink-0 flex flex-col bg-zinc-900/50 rounded-lg border border-zinc-800">
                <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between"
                  style={{ borderTopColor: stage.color, borderTopWidth: 2, borderTopStyle: "solid" }}>
                  <span className="text-xs font-semibold text-zinc-200">{stage.name}</span>
                  <span className="text-xs text-zinc-500 font-mono">{stageCards.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {stageCards.map((card) => {
                    const idle = daysSince(card.last_contacted_at);
                    return (
                      <div key={card.id}
                        draggable
                        onDragStart={() => setDragId(card.id)}
                        onDragEnd={() => setDragId(null)}
                        className="p-2.5 bg-zinc-800 border border-zinc-700 rounded cursor-move hover:border-zinc-600 transition-colors">
                        <p className="text-xs font-medium text-zinc-100">{card.company_name}</p>
                        <div className="flex items-center justify-between mt-1.5 text-[10px] text-zinc-500 font-mono">
                          <span>{card.state ?? "—"} · {card.total_loads} loads</span>
                          {idle != null && (
                            <span className={idle > 14 ? "text-yellow-400" : "text-zinc-500"}>
                              {idle}d ago
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

Add to sidebar and router (same pattern as Loads in Unit 1 step 11). Use shortcut `⌘5`.

---

### Step 6: "Add to pipeline" button on Contact Detail

**File to modify:** `src/components/contacts/ContactDetail.tsx`

Above the loads section from Unit 1 step 12, add:

```tsx
const [stages, setStages] = useState<PipelineStage[]>([]);
const [stageMenuOpen, setStageMenuOpen] = useState(false);

useEffect(() => { db.getPipelineStages().then(setStages); }, []);

// In render, in the header area:
<div className="relative">
  <button onClick={() => setStageMenuOpen((x) => !x)}
    className="text-xs px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white rounded">
    Add to pipeline
  </button>
  {stageMenuOpen && (
    <div className="absolute mt-1 right-0 bg-zinc-900 border border-zinc-700 rounded shadow-lg z-10 min-w-[180px]">
      {stages.map((s) => (
        <button key={s.id}
          onClick={async () => {
            await db.addContactToPipeline(contact.id, s.id);
            setStageMenuOpen(false);
            toast.success(`Added to ${s.name}`);
          }}
          className="block w-full text-left px-3 py-2 text-xs hover:bg-zinc-800 text-zinc-300">
          <span style={{color: s.color}}>●</span> {s.name}
        </button>
      ))}
    </div>
  )}
</div>
```

---

### Step 7: Business identity in Settings (MC / DOT / SCAC)

**File to modify:** `src/views/SettingsView.tsx`

Add a section above "Anthropic API key":

```tsx
{/* Business identity */}
<section>
  <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Business identity</h2>
  <p className="text-xs text-zinc-600 mb-3">
    These appear on every rate confirmation you generate.
  </p>
  <div className="space-y-2">
    {(["company_legal_name", "mc_number", "dot_number", "scac"] as const).map((key) => (
      <div key={key} className="flex gap-2 items-center">
        <label className="text-xs text-zinc-500 font-mono w-32 capitalize">{key.replace(/_/g, " ")}</label>
        <input value={settings[key] ?? ""}
          onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))}
          placeholder={key === "mc_number" ? "1136566" : key === "scac" ? "AFUO" : ""}
          className="flex-1 h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
        <button onClick={() => saveSetting(key, settings[key] ?? "")}
          disabled={saving === key}
          className="px-3 py-1.5 text-xs font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50">
          {saving === key ? "…" : "Save"}
        </button>
      </div>
    ))}
  </div>
</section>
```

Defaults to load: `company_legal_name`, `mc_number = 1136566`, `dot_number = 3471790`, `scac = AFUO`.

**Verify:** Type in each field, click Save → toast "Saved". Reload settings → values persist (they're stored in `app_settings` via the existing `update_setting` command).

---

### Step 8: `rate_con_templates` + `rate_cons` tables (v5 migration)

**File to modify:** `src-tauri/src/db.rs`

```rust
async fn apply_v5(conn: &libsql::Connection) -> Result<(), libsql::Error> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS rate_con_templates (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            -- Per-shipper template (NULL = default template)
            contact_id   INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
            -- The body is a handlebars-style template with {{...}} placeholders
            body_template TEXT NOT NULL,
            is_default   INTEGER NOT NULL DEFAULT 0,
            created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_rct_contact ON rate_con_templates(contact_id);

        CREATE TABLE IF NOT EXISTS rate_cons (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            load_id       INTEGER NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
            template_id   INTEGER REFERENCES rate_con_templates(id) ON DELETE SET NULL,
            rendered_text TEXT NOT NULL,
            -- File output (when user clicks 'Save as PDF' or 'Save as DOCX')
            file_path     TEXT,
            sent_at       INTEGER,
            created_at    INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_rc_load ON rate_cons(load_id);

        -- Seed the default template
        INSERT OR IGNORE INTO rate_con_templates (name, body_template, is_default) VALUES (
            'AFUO default',
            'RATE CONFIRMATION
==================

BROKER
{{company_legal_name}}
MC {{mc_number}} · DOT {{dot_number}} · SCAC {{scac}}

CARRIER
{{carrier_name}} (MC {{carrier_mc}})

LOAD DETAILS
{{consignee_name}} — {{dest_city}}, {{dest_state}}
Order# / PO#: {{order_number}} / {{po_number}}
Commodity: {{commodity}}
Weight: {{weight_lbs}} lbs · {{pallet_count}} pallets

PICKUP
{{origin_city}}, {{origin_state}}  ·  {{pickup_date_fmt}}

DELIVERY
{{dest_city}}, {{dest_state}}  ·  {{delivery_date_fmt}}

RATE
${{rate_dollars}}

NOTES
{{notes}}

By accepting this load, carrier agrees to AFUO standard terms.
Signed: ______________________  Date: __________',
            1
        );
    ").await?;
    Ok(())
}
```

Wire it in `init_schema_async` with `if current < 5 { apply_v5... }`.

**Verify:** `SELECT body_template FROM rate_con_templates WHERE is_default = 1` returns the AFUO default.

---

### Step 9: Rate con generator backend

**File to create:** `src-tauri/src/commands/rate_cons.rs`

```rust
use crate::AppState;
use crate::db::last_insert_rowid;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct RateCon {
    pub id: i64,
    pub load_id: i64,
    pub template_id: Option<i64>,
    pub rendered_text: String,
    pub file_path: Option<String>,
    pub sent_at: Option<i64>,
    pub created_at: i64,
}

#[tauri::command]
pub async fn generate_rate_con(
    state: State<'_, AppState>,
    load_id: i64,
    template_id: Option<i64>,
) -> Result<RateCon, String> {
    let conn = state.conn()?;

    // 1. Load the load with shipper
    let mut row = conn.query(
        "SELECT consignee_name, dest_city, dest_state, origin_city, origin_state,
                order_number, po_number, commodity, weight_lbs, pallet_count,
                rate_cents, carrier_name, carrier_mc, pickup_date, delivery_date,
                notes, shipper_contact_id
         FROM loads WHERE id = ?1",
        libsql::params![load_id],
    ).await.map_err(|e| e.to_string())?;
    let r = row.next().await.map_err(|e| e.to_string())?.ok_or("Load not found")?;

    // 2. Load app_settings for business identity
    let mut settings: HashMap<String, String> = HashMap::new();
    let mut s_rows = conn.query("SELECT key, value FROM app_settings", ()).await.map_err(|e| e.to_string())?;
    while let Some(sr) = s_rows.next().await.map_err(|e| e.to_string())? {
        settings.insert(
            sr.get::<String>(0).map_err(|e| e.to_string())?,
            sr.get::<String>(1).map_err(|e| e.to_string())?,
        );
    }

    // 3. Pick template — explicit id > shipper-specific > default
    let shipper_id: Option<i64> = r.get::<Option<i64>>(16).ok().flatten();
    let template = if let Some(tid) = template_id {
        load_template(&conn, Some(tid)).await?
    } else if let Some(sid) = shipper_id {
        if let Ok(t) = load_template_for_shipper(&conn, sid).await {
            t
        } else {
            load_template(&conn, None).await?
        }
    } else {
        load_template(&conn, None).await?
    };

    // 4. Build the substitution map
    let mut map: HashMap<&str, String> = HashMap::new();
    let get_str = |idx: usize| -> String {
        r.get::<Option<String>>(idx).ok().flatten().unwrap_or_default()
    };
    let pickup_ts: Option<i64> = r.get::<Option<i64>>(13).ok().flatten();
    let delivery_ts: Option<i64> = r.get::<Option<i64>>(14).ok().flatten();
    let rate_cents: Option<i64> = r.get::<Option<i64>>(10).ok().flatten();

    map.insert("consignee_name", get_str(0));
    map.insert("dest_city", get_str(1));
    map.insert("dest_state", get_str(2));
    map.insert("origin_city", get_str(3));
    map.insert("origin_state", get_str(4));
    map.insert("order_number", get_str(5));
    map.insert("po_number", get_str(6));
    map.insert("commodity", get_str(7));
    map.insert("weight_lbs", r.get::<Option<i64>>(8).ok().flatten().map(|n| n.to_string()).unwrap_or_default());
    map.insert("pallet_count", r.get::<Option<i64>>(9).ok().flatten().map(|n| n.to_string()).unwrap_or_default());
    map.insert("rate_dollars", rate_cents.map(|c| format!("{:.2}", c as f64 / 100.0)).unwrap_or_else(|| "0.00".into()));
    map.insert("carrier_name", get_str(11));
    map.insert("carrier_mc", get_str(12));
    map.insert("pickup_date_fmt", fmt_date(pickup_ts));
    map.insert("delivery_date_fmt", fmt_date(delivery_ts));
    map.insert("notes", get_str(15));

    // Business identity
    map.insert("company_legal_name", settings.get("company_legal_name").cloned().unwrap_or_else(|| "AFUO Logistics".into()));
    map.insert("mc_number", settings.get("mc_number").cloned().unwrap_or_else(|| "1136566".into()));
    map.insert("dot_number", settings.get("dot_number").cloned().unwrap_or_else(|| "3471790".into()));
    map.insert("scac", settings.get("scac").cloned().unwrap_or_else(|| "AFUO".into()));

    // 5. Substitute {{key}} placeholders
    let mut rendered = template.body_template.clone();
    for (k, v) in &map {
        rendered = rendered.replace(&format!("{{{{{}}}}}", k), v);
    }

    // 6. Persist
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO rate_cons (load_id, template_id, rendered_text, created_at) VALUES (?1, ?2, ?3, ?4)",
        libsql::params![load_id, template.id, rendered.clone(), now],
    ).await.map_err(|e| e.to_string())?;
    let id = last_insert_rowid(&conn).await?;

    Ok(RateCon {
        id,
        load_id,
        template_id: Some(template.id),
        rendered_text: rendered,
        file_path: None,
        sent_at: None,
        created_at: now,
    })
}

struct Template { id: i64, body_template: String }

async fn load_template(conn: &libsql::Connection, id: Option<i64>) -> Result<Template, String> {
    let sql = match id {
        Some(_) => "SELECT id, body_template FROM rate_con_templates WHERE id = ?1",
        None    => "SELECT id, body_template FROM rate_con_templates WHERE is_default = 1 LIMIT 1",
    };
    let mut rows = match id {
        Some(i) => conn.query(sql, libsql::params![i]).await,
        None    => conn.query(sql, ()).await,
    }.map_err(|e| e.to_string())?;
    let r = rows.next().await.map_err(|e| e.to_string())?.ok_or("No template")?;
    Ok(Template {
        id: r.get::<i64>(0).map_err(|e| e.to_string())?,
        body_template: r.get::<String>(1).map_err(|e| e.to_string())?,
    })
}

async fn load_template_for_shipper(conn: &libsql::Connection, contact_id: i64) -> Result<Template, String> {
    let mut rows = conn.query(
        "SELECT id, body_template FROM rate_con_templates WHERE contact_id = ?1 LIMIT 1",
        libsql::params![contact_id],
    ).await.map_err(|e| e.to_string())?;
    let r = rows.next().await.map_err(|e| e.to_string())?.ok_or("No shipper-specific template")?;
    Ok(Template {
        id: r.get::<i64>(0).map_err(|e| e.to_string())?,
        body_template: r.get::<String>(1).map_err(|e| e.to_string())?,
    })
}

fn fmt_date(ts: Option<i64>) -> String {
    ts.map(|t| {
        chrono::DateTime::from_timestamp(t, 0)
            .map(|d| d.format("%a %b %d, %Y").to_string())
            .unwrap_or_default()
    }).unwrap_or_default()
}
```

Register in `mod.rs` + `lib.rs`.

---

### Step 10: Rate con UI button on the load row

**File to modify:** `src/views/LoadsView.tsx` (or add to a new `LoadDetailModal.tsx` if you want a fuller drawer — recommended)

Add an action button per row that calls `generate_rate_con`, then opens a modal showing the rendered text with **Copy**, **Save as .txt**, and **Save as .pdf** buttons.

```tsx
// Inside the row's last cell:
<button
  onClick={async () => {
    try {
      const rc = await invoke<{ rendered_text: string }>("generate_rate_con", { loadId: l.id });
      setRateConText(rc.rendered_text);
    } catch (e) { toast.error(humanError(e)); }
  }}
  className="text-xs text-indigo-400 hover:text-indigo-300">Rate con →</button>
```

Then a modal with a `<pre>` showing `rateConText` and a Copy button (`navigator.clipboard.writeText(rateConText)`). PDF export is optional — defer to v2 (use `jspdf` or print-to-PDF from a styled HTML view).

**Decision: PDF library.** Pick one:
- **(A) jsPDF** — pure JS, small, ugly default fonts. Recommended for v1.
- **(B) print-to-PDF** — render the text in a styled HTML view, use `window.print()` with `@media print` CSS, user picks "Save as PDF" in the browser print dialog. Recommended if you want better-looking output.
- **(C) Tauri-side via `printpdf` Rust crate** — heaviest, best output. Overkill for v1.

**Recommendation:** B for v1 — zero deps, prettier output. Use A or C later.

---

### Step 11: Per-shipper rate con template UI

**Accomplishes:** Power-user override — some shippers (Costco, HEB, Sysco) want their own format.

In the Contact Detail page, add a small section:
- "Custom rate con template" — a text area
- If filled, saves as a row in `rate_con_templates` with `contact_id = this.id`
- Generate button on a load for this shipper will pick this template automatically

```tsx
const [tpl, setTpl] = useState("");
// Load existing on mount, save on blur:
const saveTpl = async () => {
  await invoke("save_shipper_template", { contactId: contact.id, body: tpl });
  toast.success("Template saved");
};
```

(You'll need to add a `save_shipper_template` Rust command — simple INSERT OR REPLACE on `rate_con_templates` with `contact_id` matching).

---

## How to test the whole unit

1. `⌘5` opens Pipeline. 7 columns visible: Lead, Qualified, Setup Packet Sent, First Load Booked, Active, Dormant, Declined.
2. Open a contact. Click "Add to pipeline" → pick "Lead". Toast.
3. Return to Pipeline (`⌘5`). Card appears in Lead column with shipper name, state, total_loads, and "Xd ago" if you've contacted them.
4. Drag the card to "Qualified". Drop. Card moves. Refresh — it stays in Qualified.
5. Press `⌘,` Settings. Type MC=1136566, DOT=3471790, SCAC=AFUO, company_legal_name="AFUO Logistics LLC". Save each.
6. Press `⌘4` Loads. Open a load (or create one with full carrier info via Quick Load + then manually edit).
7. Click "Rate con →" on a load row. Modal shows a clean rendered rate confirmation with all your business info, the consignee/destination header, order#/po#, commodity, weights, pallets, rate, pickup/delivery dates.
8. Click Copy → paste in a text editor → looks right.
9. Open the shipper contact for that load. Set a custom template (e.g., add `*** HEB CUSTOM ***` at the top of the template body). Save.
10. Generate rate con on a load for that shipper again — it uses the custom template (you see the marker).
11. Go back to Pipeline. Move the card to "Active". Note that `is_terminal=1` for Active — in the next unit (Customer Success) cards here become the source of the "needs follow-up" view.

If all 11 steps work, Unit 2 is done.

---

## What to tell Claude Code to build this for me

```text
Execute build_manual/02_crm.md from start to finish. Unit 1 must already be merged on this branch.

Constraints:
- Stack is fixed: Tauri 2 + React 19 + Turso/libSQL + Zustand. No alternatives.
- All schema changes go in src-tauri/src/db.rs via apply_vN. This is v4 (pipeline) and v5 (rate cons).
- All Rust commands must be registered in src-tauri/src/lib.rs invoke_handler.
- All TS types go in src/types/index.ts.
- Drag-and-drop in Step 5 uses native HTML5 drag events. Do NOT add react-dnd or other libs.
- For Step 10 PDF export: pick Option B (print-to-PDF via styled HTML + window.print). Do not add jspdf.
- Use TodoWrite to track each step. Mark each done as you verify.
- Stop after the 11-step walkthrough at the end and report which steps passed. Do not start Unit 3.
```

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Pipeline shows 0 stages | v4 migration didn't run | Check `schema_migrations`. If version 4 missing, run apply_v4 manually via Turso shell. |
| Card drops back to original column | `move_pipeline_card` not registered in lib.rs | Add the handler. |
| Custom shipper template ignored | `contact_id` is null on the row, or the load's `shipper_contact_id` is null | The rate con generator falls back to default if either is missing. Make sure the load has a shipper assigned. |
| Generated rate con has literal `{{rate_dollars}}` text | A template var was renamed and not updated in the generator's substitution map | Cross-check the template body keys against the map in `generate_rate_con`. |
| Drag-drop doesn't trigger on Tauri webview | Some WebView versions don't fire `dragover` reliably | Add `onDragEnter={(e) => e.preventDefault()}` as a backup. Test on both Mac and Windows. |
| PDF export prints the sidebar too | Missing `@media print` CSS to hide chrome | Add `@media print { .sidebar, .status-bar { display: none } body { background: white; color: black } }`. |
