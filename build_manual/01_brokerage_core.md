# Unit 1 — Brokerage Core

## What you're building

A load tracker tied to your existing shipper records. Every load you book is a row with the exact structure you already use day-to-day: header `[Consignee] — [Destination City, ST]` followed by numbered detail lines (`1) Order# / PO# / Weight / Pallets / Cases`). Shippers gain a relationship state field so you can tell prospect from active from dormant at a glance. When this unit is done you can log a load in 30 seconds, see all loads per shipper, and search loads by lane, commodity, or consignee.

---

## Prerequisites

- [x] Turso connected — `local_config.json` has `turso_url` and `turso_token`, sidebar dot shows green
- [x] `contacts` table populated (or at least 1 contact created manually to test against)
- [x] `src-tauri/src/db.rs` `init_schema_async` is the single source of truth for schema (verify by reading the file)
- [x] You've read `00_audit.md` — specifically Conflict 1 (R5 reversal) and Conflict 3 (terminology)
- [x] You've made a Turso backup (Diagnostics ⌘⇧D → Export everything)
- [x] You're working on a branch: `git checkout -b feature/unit-1-brokerage-core`

---

## Step-by-step build

### Step 1: Retire R5 in `docs/BUILD_PLAN.md`

**Accomplishes:** Removes the "no loads tracking" constraint so future-you doesn't hit a contradiction when reviewing the plan.

**File to modify:** `docs/BUILD_PLAN.md`

**Change:** Find the `### R5: No loads tracking / rate confirmations` section. Replace it with:

```markdown
### R5: Loads tracking IS in scope (revised 2026-05-17)

Per the Disney 1957 strategy map, the brokerage is the creative engine
every other unit feeds. Tracking loads inside the CRM is the only way to
capture the lane data, shipper preferences, and stories the lead-gen,
newsletter, and content units need as raw material.

Load tracker design lives in `build_manual/01_brokerage_core.md`.
Rate confirmation generator design lives in `build_manual/02_crm.md`.
```

**Verify:** `grep "R5" docs/BUILD_PLAN.md` should return only the new text.

---

### Step 2: Add `relationship_state` column to `contacts`

**Accomplishes:** Distinguishes prospect (never booked a load) from active (booked recently) from dormant (booked but gone quiet) from declined (do-not-call). Lets every other unit filter on intent without renaming the `contacts` table.

**File to modify:** `src-tauri/src/db.rs`

**Schema migration (add as v3):**

```rust
async fn apply_v3(conn: &libsql::Connection) -> Result<(), libsql::Error> {
    // Ignore errors — columns may already exist on re-run
    let _ = conn.execute(
        "ALTER TABLE contacts ADD COLUMN relationship_state TEXT NOT NULL DEFAULT 'prospect'",
        (),
    ).await;
    let _ = conn.execute(
        "ALTER TABLE contacts ADD COLUMN first_load_at INTEGER",
        (),
    ).await;
    let _ = conn.execute(
        "ALTER TABLE contacts ADD COLUMN total_loads INTEGER NOT NULL DEFAULT 0",
        (),
    ).await;
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_c_relstate ON contacts(relationship_state)",
        (),
    ).await;
    Ok(())
}
```

**Wire it up in `init_schema_async`:**

```rust
if current < 3 {
    apply_v3(conn).await?;
    conn.execute("INSERT INTO schema_migrations (version) VALUES (3)", ()).await?;
}
```

**Allowed values for `relationship_state`:**

| Value | Meaning |
|---|---|
| `prospect` | Lead — never booked a load |
| `active` | Booked in last 60 days |
| `dormant` | Booked once but not in 60+ days |
| `declined` | Do-not-call / not interested |

**Verify:** Restart the dev server, watch the log for `[startup] auto-reconnect successful`. Then in DiagnosticsPanel run a quick contacts query (or use `turso db shell <db> "SELECT relationship_state, COUNT(*) FROM contacts GROUP BY relationship_state"`). All existing rows should show `prospect`.

---

### Step 3: Add the `loads` table

**Accomplishes:** The single source of truth for every load you book. Mirrors the format you already use in your notebook.

**File to modify:** `src-tauri/src/db.rs`

**Add to `apply_v3` (same migration as step 2):**

```rust
conn.execute_batch("
    CREATE TABLE IF NOT EXISTS loads (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,

        -- Header: '[Consignee] — [Destination City, ST]'
        consignee_name        TEXT NOT NULL,
        dest_city             TEXT,
        dest_state            TEXT,

        -- Origin
        origin_city           TEXT,
        origin_state          TEXT,

        -- Shipper (FK into contacts)
        shipper_contact_id    INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
        shipper_name_snapshot TEXT,  -- denormalized in case shipper is deleted

        -- Load identity
        order_number          TEXT,    -- shipper's order #
        po_number             TEXT,    -- PO #
        pro_number            TEXT,    -- carrier PRO if assigned
        commodity             TEXT,    -- e.g. 'Romaine', 'Mixed produce'

        -- Quantities
        weight_lbs            INTEGER,
        pallet_count          INTEGER,
        case_count            INTEGER,

        -- Pricing
        rate_cents            INTEGER,  -- store in cents to avoid float
        carrier_pay_cents     INTEGER,  -- what we pay the truck
        margin_cents          INTEGER GENERATED ALWAYS AS (rate_cents - carrier_pay_cents) VIRTUAL,

        -- Carrier
        carrier_name          TEXT,
        carrier_mc            TEXT,
        driver_name           TEXT,
        truck_number          TEXT,

        -- Status / dates
        pickup_date           INTEGER,        -- unix ts
        delivery_date         INTEGER,        -- unix ts
        status                TEXT NOT NULL DEFAULT 'booked',
            -- booked | dispatched | in_transit | delivered | cancelled | claim

        -- Free-form notes (per-load detail beyond structured fields)
        notes                 TEXT,

        -- Audit
        created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
        user_id               TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_loads_shipper   ON loads(shipper_contact_id);
    CREATE INDEX IF NOT EXISTS idx_loads_status    ON loads(status);
    CREATE INDEX IF NOT EXISTS idx_loads_pickup    ON loads(pickup_date);
    CREATE INDEX IF NOT EXISTS idx_loads_commodity ON loads(commodity);
    CREATE INDEX IF NOT EXISTS idx_loads_lane      ON loads(origin_state, dest_state);
").await?;
```

**Notes on the schema:**
- `shipper_name_snapshot` is denormalized on purpose — if the shipper contact is deleted, the load still shows who it was for
- `rate_cents` and `carrier_pay_cents` in cents avoids float rounding; `margin_cents` is a generated column so you never compute margin in app code
- `commodity` is free-text on purpose — produce specifics matter ("romaine" vs "lettuce" vs "mixed produce")
- `status` defaults to `booked` because that's the moment you create a load record

**Verify:** Restart, check `schema_migrations` table has version 3. Verify `loads` exists with `PRAGMA table_info(loads)` via Diagnostics.

---

### Step 4: Add the `Load` Rust struct

**Accomplishes:** Defines what crosses the FFI boundary between Rust and the React frontend.

**File to modify:** `src-tauri/src/models.rs`

**Add to the bottom (before the closing of the Startup section):**

```rust
// ── Loads ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Load {
    pub id: i64,
    pub consignee_name: String,
    pub dest_city: Option<String>,
    pub dest_state: Option<String>,
    pub origin_city: Option<String>,
    pub origin_state: Option<String>,
    pub shipper_contact_id: Option<i64>,
    pub shipper_name_snapshot: Option<String>,
    pub order_number: Option<String>,
    pub po_number: Option<String>,
    pub pro_number: Option<String>,
    pub commodity: Option<String>,
    pub weight_lbs: Option<i64>,
    pub pallet_count: Option<i64>,
    pub case_count: Option<i64>,
    pub rate_cents: Option<i64>,
    pub carrier_pay_cents: Option<i64>,
    pub margin_cents: Option<i64>,
    pub carrier_name: Option<String>,
    pub carrier_mc: Option<String>,
    pub driver_name: Option<String>,
    pub truck_number: Option<String>,
    pub pickup_date: Option<i64>,
    pub delivery_date: Option<i64>,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub user_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateLoadData {
    pub consignee_name: String,
    pub dest_city: Option<String>,
    pub dest_state: Option<String>,
    pub origin_city: Option<String>,
    pub origin_state: Option<String>,
    pub shipper_contact_id: Option<i64>,
    pub order_number: Option<String>,
    pub po_number: Option<String>,
    pub commodity: Option<String>,
    pub weight_lbs: Option<i64>,
    pub pallet_count: Option<i64>,
    pub case_count: Option<i64>,
    pub rate_cents: Option<i64>,
    pub carrier_pay_cents: Option<i64>,
    pub carrier_name: Option<String>,
    pub carrier_mc: Option<String>,
    pub driver_name: Option<String>,
    pub truck_number: Option<String>,
    pub pickup_date: Option<i64>,
    pub delivery_date: Option<i64>,
    pub status: Option<String>,
    pub notes: Option<String>,
    pub user_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoadFilter {
    pub shipper_contact_id: Option<i64>,
    pub status: Option<String>,
    pub commodity: Option<String>,
    pub origin_state: Option<String>,
    pub dest_state: Option<String>,
    pub search: Option<String>,
    pub date_from: Option<i64>,
    pub date_to: Option<i64>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}
```

**Verify:** `cargo check` passes. (Tauri dev server's watch should auto-trigger this — look for `Finished dev profile`.)

---

### Step 5: Create the `loads.rs` commands file

**Accomplishes:** CRUD + filtered list for loads, plus a side-effect: bumping the shipper's `last_load_at` / `total_loads` / `relationship_state` on insert.

**File to create:** `src-tauri/src/commands/loads.rs`

**Full content:**

```rust
use crate::{AppState, CreateLoadData, Load, LoadFilter};
use crate::db::last_insert_rowid;
use libsql::Value;
use tauri::State;

#[tauri::command]
pub async fn create_load(
    state: State<'_, AppState>,
    data: CreateLoadData,
) -> Result<Load, String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();

    // Snapshot shipper name from contacts if we have an id
    let shipper_name = if let Some(sid) = data.shipper_contact_id {
        let mut r = conn.query(
            "SELECT company_name FROM contacts WHERE id = ?1",
            libsql::params![sid],
        ).await.map_err(|e| e.to_string())?;
        r.next().await.map_err(|e| e.to_string())?
            .and_then(|row| row.get::<String>(0).ok())
    } else { None };

    conn.execute(
        "INSERT INTO loads (
            consignee_name, dest_city, dest_state, origin_city, origin_state,
            shipper_contact_id, shipper_name_snapshot,
            order_number, po_number, commodity,
            weight_lbs, pallet_count, case_count,
            rate_cents, carrier_pay_cents,
            carrier_name, carrier_mc, driver_name, truck_number,
            pickup_date, delivery_date, status, notes,
            created_at, updated_at, user_id
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?24,?25)",
        libsql::params![
            data.consignee_name,
            data.dest_city, data.dest_state, data.origin_city, data.origin_state,
            data.shipper_contact_id, shipper_name,
            data.order_number, data.po_number, data.commodity,
            data.weight_lbs, data.pallet_count, data.case_count,
            data.rate_cents, data.carrier_pay_cents,
            data.carrier_name, data.carrier_mc, data.driver_name, data.truck_number,
            data.pickup_date, data.delivery_date,
            data.status.unwrap_or_else(|| "booked".to_string()),
            data.notes,
            now,
            data.user_id,
        ],
    ).await.map_err(|e| e.to_string())?;

    let id = last_insert_rowid(&conn).await?;

    // Bump shipper counters + relationship_state
    if let Some(sid) = data.shipper_contact_id {
        conn.execute(
            "UPDATE contacts
             SET total_loads = total_loads + 1,
                 first_load_at = COALESCE(first_load_at, ?1),
                 last_contacted_at = ?1,
                 relationship_state = 'active',
                 updated_at = ?1
             WHERE id = ?2",
            libsql::params![now, sid],
        ).await.map_err(|e| e.to_string())?;
    }

    fetch_load(&conn, id).await
}

#[tauri::command]
pub async fn get_loads(
    state: State<'_, AppState>,
    filter: LoadFilter,
) -> Result<Vec<Load>, String> {
    let conn = state.conn()?;

    let mut sql = String::from(
        "SELECT id, consignee_name, dest_city, dest_state, origin_city, origin_state,
                shipper_contact_id, shipper_name_snapshot, order_number, po_number,
                pro_number, commodity, weight_lbs, pallet_count, case_count,
                rate_cents, carrier_pay_cents, margin_cents,
                carrier_name, carrier_mc, driver_name, truck_number,
                pickup_date, delivery_date, status, notes,
                created_at, updated_at, user_id
         FROM loads WHERE 1=1"
    );
    let mut params: Vec<Value> = vec![];

    if let Some(sid) = filter.shipper_contact_id {
        sql.push_str(" AND shipper_contact_id = ?");
        params.push(Value::Integer(sid));
    }
    if let Some(s) = filter.status {
        sql.push_str(" AND status = ?");
        params.push(Value::Text(s));
    }
    if let Some(c) = filter.commodity {
        sql.push_str(" AND commodity LIKE ?");
        params.push(Value::Text(format!("%{}%", c)));
    }
    if let Some(s) = filter.origin_state {
        sql.push_str(" AND origin_state = ?");
        params.push(Value::Text(s));
    }
    if let Some(s) = filter.dest_state {
        sql.push_str(" AND dest_state = ?");
        params.push(Value::Text(s));
    }
    if let Some(q) = filter.search {
        sql.push_str(" AND (consignee_name LIKE ? OR shipper_name_snapshot LIKE ? OR order_number LIKE ? OR po_number LIKE ?)");
        let pat = format!("%{}%", q);
        params.push(Value::Text(pat.clone()));
        params.push(Value::Text(pat.clone()));
        params.push(Value::Text(pat.clone()));
        params.push(Value::Text(pat));
    }
    if let Some(d) = filter.date_from {
        sql.push_str(" AND pickup_date >= ?");
        params.push(Value::Integer(d));
    }
    if let Some(d) = filter.date_to {
        sql.push_str(" AND pickup_date <= ?");
        params.push(Value::Integer(d));
    }

    sql.push_str(" ORDER BY pickup_date DESC, created_at DESC LIMIT ? OFFSET ?");
    params.push(Value::Integer(filter.limit.unwrap_or(100)));
    params.push(Value::Integer(filter.offset.unwrap_or(0)));

    let mut rows = conn.query(&sql, params).await.map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        result.push(row_to_load(&row)?);
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_load(state: State<'_, AppState>, id: i64) -> Result<Load, String> {
    let conn = state.conn()?;
    fetch_load(&conn, id).await
}

#[tauri::command]
pub async fn update_load_status(
    state: State<'_, AppState>,
    id: i64,
    status: String,
) -> Result<Load, String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE loads SET status = ?1, updated_at = ?2 WHERE id = ?3",
        libsql::params![status, now, id],
    ).await.map_err(|e| e.to_string())?;
    fetch_load(&conn, id).await
}

#[tauri::command]
pub async fn delete_load(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute("DELETE FROM loads WHERE id = ?1", libsql::params![id])
        .await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn fetch_load(conn: &libsql::Connection, id: i64) -> Result<Load, String> {
    let mut rows = conn.query(
        "SELECT id, consignee_name, dest_city, dest_state, origin_city, origin_state,
                shipper_contact_id, shipper_name_snapshot, order_number, po_number,
                pro_number, commodity, weight_lbs, pallet_count, case_count,
                rate_cents, carrier_pay_cents, margin_cents,
                carrier_name, carrier_mc, driver_name, truck_number,
                pickup_date, delivery_date, status, notes,
                created_at, updated_at, user_id
         FROM loads WHERE id = ?1",
        libsql::params![id],
    ).await.map_err(|e| e.to_string())?;
    let row = rows.next().await.map_err(|e| e.to_string())?.ok_or("Load not found")?;
    row_to_load(&row)
}

fn row_to_load(row: &libsql::Row) -> Result<Load, String> {
    Ok(Load {
        id: row.get::<i64>(0).map_err(|e| e.to_string())?,
        consignee_name: row.get::<String>(1).map_err(|e| e.to_string())?,
        dest_city: row.get::<Option<String>>(2).ok().flatten(),
        dest_state: row.get::<Option<String>>(3).ok().flatten(),
        origin_city: row.get::<Option<String>>(4).ok().flatten(),
        origin_state: row.get::<Option<String>>(5).ok().flatten(),
        shipper_contact_id: row.get::<Option<i64>>(6).ok().flatten(),
        shipper_name_snapshot: row.get::<Option<String>>(7).ok().flatten(),
        order_number: row.get::<Option<String>>(8).ok().flatten(),
        po_number: row.get::<Option<String>>(9).ok().flatten(),
        pro_number: row.get::<Option<String>>(10).ok().flatten(),
        commodity: row.get::<Option<String>>(11).ok().flatten(),
        weight_lbs: row.get::<Option<i64>>(12).ok().flatten(),
        pallet_count: row.get::<Option<i64>>(13).ok().flatten(),
        case_count: row.get::<Option<i64>>(14).ok().flatten(),
        rate_cents: row.get::<Option<i64>>(15).ok().flatten(),
        carrier_pay_cents: row.get::<Option<i64>>(16).ok().flatten(),
        margin_cents: row.get::<Option<i64>>(17).ok().flatten(),
        carrier_name: row.get::<Option<String>>(18).ok().flatten(),
        carrier_mc: row.get::<Option<String>>(19).ok().flatten(),
        driver_name: row.get::<Option<String>>(20).ok().flatten(),
        truck_number: row.get::<Option<String>>(21).ok().flatten(),
        pickup_date: row.get::<Option<i64>>(22).ok().flatten(),
        delivery_date: row.get::<Option<i64>>(23).ok().flatten(),
        status: row.get::<String>(24).map_err(|e| e.to_string())?,
        notes: row.get::<Option<String>>(25).ok().flatten(),
        created_at: row.get::<i64>(26).map_err(|e| e.to_string())?,
        updated_at: row.get::<i64>(27).map_err(|e| e.to_string())?,
        user_id: row.get::<Option<String>>(28).ok().flatten(),
    })
}
```

**Verify:** `cargo check`. No errors.

---

### Step 6: Register `loads` module + commands

**Accomplishes:** Makes the commands callable from the frontend.

**File to modify:** `src-tauri/src/commands/mod.rs`

**Add:**
```rust
pub mod loads;
```

**File to modify:** `src-tauri/src/lib.rs`

**Add inside `tauri::generate_handler![...]`:**
```rust
commands::loads::create_load,
commands::loads::get_loads,
commands::loads::get_load,
commands::loads::update_load_status,
commands::loads::delete_load,
```

**Verify:** Dev server picks up the change, recompiles in <15s, no errors.

---

### Step 7: TypeScript types + db.ts wrappers

**Accomplishes:** Lets React call the new commands type-safely.

**File to modify:** `src/types/index.ts`

**Add at the bottom (before `// ── UI ──`):**

```typescript
// ── Loads ─────────────────────────────────────────────────────────────

export type LoadStatus =
  | "booked"
  | "dispatched"
  | "in_transit"
  | "delivered"
  | "cancelled"
  | "claim";

export interface Load {
  id: number;
  consignee_name: string;
  dest_city?: string;
  dest_state?: string;
  origin_city?: string;
  origin_state?: string;
  shipper_contact_id?: number;
  shipper_name_snapshot?: string;
  order_number?: string;
  po_number?: string;
  pro_number?: string;
  commodity?: string;
  weight_lbs?: number;
  pallet_count?: number;
  case_count?: number;
  rate_cents?: number;
  carrier_pay_cents?: number;
  margin_cents?: number;
  carrier_name?: string;
  carrier_mc?: string;
  driver_name?: string;
  truck_number?: string;
  pickup_date?: number;
  delivery_date?: number;
  status: LoadStatus;
  notes?: string;
  created_at: number;
  updated_at: number;
  user_id?: string;
}

export interface CreateLoadData {
  consignee_name: string;
  dest_city?: string;
  dest_state?: string;
  origin_city?: string;
  origin_state?: string;
  shipper_contact_id?: number;
  order_number?: string;
  po_number?: string;
  commodity?: string;
  weight_lbs?: number;
  pallet_count?: number;
  case_count?: number;
  rate_cents?: number;
  carrier_pay_cents?: number;
  carrier_name?: string;
  carrier_mc?: string;
  driver_name?: string;
  truck_number?: string;
  pickup_date?: number;
  delivery_date?: number;
  status?: LoadStatus;
  notes?: string;
  user_id?: string;
}

export interface LoadFilter {
  shipper_contact_id?: number;
  status?: LoadStatus;
  commodity?: string;
  origin_state?: string;
  dest_state?: string;
  search?: string;
  date_from?: number;
  date_to?: number;
  limit?: number;
  offset?: number;
}
```

**File to modify:** `src/lib/db.ts`

**Add at the bottom:**
```typescript
import type { Load, LoadFilter, CreateLoadData, LoadStatus } from "../types";
// (skip the import line above if these are already added to the top-level import block)

export const createLoad = (data: CreateLoadData) =>
  invoke<Load>("create_load", { data });

export const getLoads = (filter: LoadFilter = {}) =>
  invoke<Load[]>("get_loads", { filter });

export const getLoad = (id: number) =>
  invoke<Load>("get_load", { id });

export const updateLoadStatus = (id: number, status: LoadStatus) =>
  invoke<Load>("update_load_status", { id, status });

export const deleteLoad = (id: number) =>
  invoke<void>("delete_load", { id });
```

**Verify:** `npm run build` passes (just `tsc && vite build`).

---

### Step 8: Quick-log load modal (the 30-second-entry UX)

**Accomplishes:** A keyboard-first modal that you can open from anywhere, type 6 fields, and commit a load. Modeled on the existing `QuickCallModal`.

**File to create:** `src/components/loads/QuickLoadModal.tsx`

**Full content:**

```tsx
import { useState, useRef, useEffect } from "react";
import { useUIStore } from "../../store/ui";
import * as db from "../../lib/db";
import { useToast } from "../../hooks/useToast";
import { humanError } from "../../lib/errors";
import type { ContactSummary, UserProfile } from "../../types";

const STATUSES = ["booked", "dispatched", "in_transit", "delivered"] as const;

interface Props {
  activeUser: UserProfile;
}

export function QuickLoadModal({ activeUser }: Props) {
  const open = useUIStore((s) => s.quickLoadOpen);
  const close = useUIStore((s) => s.closeQuickLoad);
  const toast = useToast();

  const [consignee, setConsignee] = useState("");
  const [destCity, setDestCity] = useState("");
  const [destState, setDestState] = useState("");
  const [shipperQuery, setShipperQuery] = useState("");
  const [shipperResults, setShipperResults] = useState<ContactSummary[]>([]);
  const [selectedShipper, setSelectedShipper] = useState<ContactSummary | null>(null);
  const [orderNumber, setOrderNumber] = useState("");
  const [commodity, setCommodity] = useState("");
  const [weight, setWeight] = useState("");
  const [pallets, setPallets] = useState("");
  const [rate, setRate] = useState("");
  const [saving, setSaving] = useState(false);
  const consigneeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setConsignee(""); setDestCity(""); setDestState("");
      setShipperQuery(""); setShipperResults([]); setSelectedShipper(null);
      setOrderNumber(""); setCommodity("");
      setWeight(""); setPallets(""); setRate("");
      setTimeout(() => consigneeRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!shipperQuery.trim() || selectedShipper) { setShipperResults([]); return; }
    db.searchContacts(shipperQuery, 5).then(setShipperResults).catch(() => {});
  }, [shipperQuery, selectedShipper]);

  const save = async () => {
    if (!consignee.trim()) { toast.error("Consignee is required"); return; }
    setSaving(true);
    try {
      const rateCents = rate ? Math.round(parseFloat(rate) * 100) : undefined;
      await db.createLoad({
        consignee_name: consignee.trim(),
        dest_city: destCity.trim() || undefined,
        dest_state: destState.trim().toUpperCase() || undefined,
        shipper_contact_id: selectedShipper?.id,
        order_number: orderNumber.trim() || undefined,
        commodity: commodity.trim() || undefined,
        weight_lbs: weight ? parseInt(weight) : undefined,
        pallet_count: pallets ? parseInt(pallets) : undefined,
        rate_cents: rateCents,
        status: "booked",
        user_id: activeUser.id,
      });
      toast.success("Load saved");
      close();
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
    if (e.key === "Escape") close();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Log load (⌘↵ to save)</h2>
        </div>
        <div className="px-5 py-4 space-y-3" onKeyDown={onKey}>
          <input ref={consigneeRef} value={consignee} onChange={(e) => setConsignee(e.target.value)}
            placeholder="Consignee" className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
          <div className="flex gap-2">
            <input value={destCity} onChange={(e) => setDestCity(e.target.value)}
              placeholder="Dest city" className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
            <input value={destState} onChange={(e) => setDestState(e.target.value)} maxLength={2}
              placeholder="ST" className="w-16 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-100 uppercase" />
          </div>

          {selectedShipper ? (
            <div className="flex items-center justify-between bg-zinc-800 px-3 py-2 rounded text-xs">
              <span className="text-zinc-200">Shipper: {selectedShipper.company_name}</span>
              <button onClick={() => setSelectedShipper(null)} className="text-zinc-500 hover:text-zinc-300">×</button>
            </div>
          ) : (
            <div className="relative">
              <input value={shipperQuery} onChange={(e) => setShipperQuery(e.target.value)}
                placeholder="Shipper (search…)" className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
              {shipperResults.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-10">
                  {shipperResults.map((s) => (
                    <button key={s.id} onClick={() => setSelectedShipper(s)}
                      className="block w-full text-left px-3 py-2 text-xs hover:bg-zinc-700 text-zinc-200">
                      {s.company_name} {s.state && <span className="text-zinc-500">· {s.state}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)}
            placeholder="Order # / PO" className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
          <input value={commodity} onChange={(e) => setCommodity(e.target.value)}
            placeholder="Commodity (e.g. Romaine)" className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
          <div className="flex gap-2">
            <input value={weight} onChange={(e) => setWeight(e.target.value)} type="number"
              placeholder="Weight lbs" className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
            <input value={pallets} onChange={(e) => setPallets(e.target.value)} type="number"
              placeholder="Pallets" className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
            <input value={rate} onChange={(e) => setRate(e.target.value)} type="number" step="0.01"
              placeholder="Rate $" className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={close} className="px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
            <button onClick={save} disabled={saving}
              className="px-4 py-1.5 text-sm font-mono bg-green-900/50 border border-green-700 text-green-200 rounded hover:bg-green-900/80 disabled:opacity-50">
              {saving ? "Saving…" : "Save load (⌘↵)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Add `quickLoadOpen` / `openQuickLoad` / `closeQuickLoad` to `src/store/ui.ts`** (same pattern as `quickCallContactId`).

**Verify:** `npm run build` passes.

---

### Step 9: Wire up the modal + `⌘L` shortcut

**Wait — `⌘L` is already taken by Quick Call.** Use `⌘⇧L` for Quick Load.

**File to modify:** `src/App.tsx`

**Add to `GlobalShortcuts`:**

```tsx
const openQuickLoad = useUIStore((s) => s.openQuickLoad);
useGlobalKeyboard("L", openQuickLoad, { meta: true, shift: true }, []);
```

**Add to the render tree inside `<AppShell>`:**

```tsx
<QuickLoadModal activeUser={activeUser} />
```

**Import it at the top.**

**Verify:** Open app, press `Ctrl+Shift+L`, the modal appears.

---

### Step 10: Loads view (the list / filter screen)

**Accomplishes:** A sidebar entry that shows all loads with filter chips for status, lane, commodity.

**File to create:** `src/views/LoadsView.tsx`

**Full content:**

```tsx
import { useState, useEffect } from "react";
import * as db from "../lib/db";
import type { Load, LoadFilter, LoadStatus } from "../types";
import { useToast } from "../hooks/useToast";
import { humanError } from "../lib/errors";

const STATUS_OPTIONS: { value: LoadStatus | "all"; label: string; color: string }[] = [
  { value: "all",        label: "All",        color: "#71717a" },
  { value: "booked",     label: "Booked",     color: "#3b82f6" },
  { value: "dispatched", label: "Dispatched", color: "#a78bfa" },
  { value: "in_transit", label: "In transit", color: "#f59e0b" },
  { value: "delivered",  label: "Delivered",  color: "#22c55e" },
  { value: "cancelled",  label: "Cancelled",  color: "#71717a" },
  { value: "claim",      label: "Claim",      color: "#ef4444" },
];

function fmtMoney(cents?: number) {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtDate(ts?: number) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString();
}

export function LoadsView() {
  const [loads, setLoads] = useState<Load[]>([]);
  const [filter, setFilter] = useState<LoadFilter>({});
  const [statusFilter, setStatusFilter] = useState<LoadStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setLoading(true);
    const f: LoadFilter = { ...filter };
    if (statusFilter !== "all") f.status = statusFilter;
    if (search.trim()) f.search = search.trim();
    db.getLoads(f).then(setLoads).catch((e) => toast.error(humanError(e))).finally(() => setLoading(false));
  }, [statusFilter, search, filter]);

  const totalRevenue = loads.reduce((s, l) => s + (l.rate_cents ?? 0), 0);
  const totalMargin  = loads.reduce((s, l) => s + (l.margin_cents ?? 0), 0);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <h2 className="text-sm font-semibold text-zinc-100">Loads</h2>
        <div className="text-xs font-mono text-zinc-500">
          {loads.length} loads · {fmtMoney(totalRevenue)} revenue · {fmtMoney(totalMargin)} margin
        </div>
      </div>

      <div className="flex items-center gap-3 px-6 py-3 border-b border-zinc-800 shrink-0">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search consignee / shipper / order #…"
          className="flex-1 px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
        <div className="flex gap-1">
          {STATUS_OPTIONS.map((s) => (
            <button key={s.value} onClick={() => setStatusFilter(s.value)}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                statusFilter === s.value ? "text-zinc-100 bg-zinc-700" : "text-zinc-500 hover:text-zinc-300"
              }`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-zinc-950 border-b border-zinc-800 text-zinc-500">
            <tr>
              <th className="text-left px-6 py-2">Consignee → Dest</th>
              <th className="text-left px-3 py-2">Shipper</th>
              <th className="text-left px-3 py-2">Commodity</th>
              <th className="text-right px-3 py-2">Pallets</th>
              <th className="text-right px-3 py-2">Rate</th>
              <th className="text-right px-3 py-2">Margin</th>
              <th className="text-left px-3 py-2">Pickup</th>
              <th className="text-left px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-zinc-600">Loading…</td></tr>
            )}
            {!loading && loads.length === 0 && (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-zinc-600">No loads. Press ⌘⇧L to log one.</td></tr>
            )}
            {loads.map((l) => (
              <tr key={l.id} className="border-b border-zinc-900 hover:bg-zinc-900/50">
                <td className="px-6 py-2 text-zinc-200">
                  {l.consignee_name}
                  {l.dest_city && <span className="text-zinc-500"> — {l.dest_city}, {l.dest_state}</span>}
                </td>
                <td className="px-3 py-2 text-zinc-400">{l.shipper_name_snapshot ?? "—"}</td>
                <td className="px-3 py-2 text-zinc-400">{l.commodity ?? "—"}</td>
                <td className="px-3 py-2 text-right text-zinc-400">{l.pallet_count ?? "—"}</td>
                <td className="px-3 py-2 text-right text-zinc-300">{fmtMoney(l.rate_cents)}</td>
                <td className="px-3 py-2 text-right text-green-400">{fmtMoney(l.margin_cents)}</td>
                <td className="px-3 py-2 text-zinc-400">{fmtDate(l.pickup_date)}</td>
                <td className="px-3 py-2">
                  <span className="px-2 py-0.5 rounded text-zinc-300 bg-zinc-800">{l.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Verify:** `npm run build`.

---

### Step 11: Add Loads to sidebar + router

**File to modify:** `src/types/index.ts`

Change `ViewName`:
```typescript
export type ViewName = "dashboard" | "contacts" | "contact-detail" | "loads" | "import" | "settings" | "strategy-map";
```

**File to modify:** `src/App.tsx`

In `Views`:
```tsx
case "loads": return <LoadsView />;
```

Add the import. Add `⌘4` shortcut to set view to loads (shift current Settings to `⌘5` or use `⌘,` for settings which is already set).

Actually current shortcuts: `⌘1` Dashboard, `⌘2` Contacts, `⌘3` Import, `⌘,` Settings. So `⌘4` is free for Loads.

```tsx
useGlobalKeyboard("4", () => setView("loads"), { meta: true }, []);
```

**File to modify:** `src/components/layout/Sidebar.tsx`

Add to the `NAV` array (between Contacts and Import):
```typescript
{ view: "loads", label: "Loads", shortcut: "4", icon: Truck },
```

(There's already a Truck icon imported, or use `Package` from lucide-react.)

**Verify:** Sidebar shows "Loads" with ⌘4 shortcut. Click it → empty loads table appears. Press ⌘⇧L → modal opens. Save a test load → it appears in the table.

---

### Step 12: Show loads on the Contact Detail page

**Accomplishes:** When you open a shipper's page, you see every load they've ever sent.

**File to modify:** `src/components/contacts/ContactDetail.tsx`

Add a new section below the activities feed:

```tsx
const [shipperLoads, setShipperLoads] = useState<Load[]>([]);
useEffect(() => {
  if (contact?.id) {
    db.getLoads({ shipper_contact_id: contact.id, limit: 50 }).then(setShipperLoads);
  }
}, [contact?.id]);

// In render:
<section className="mt-6">
  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
    Loads ({shipperLoads.length})
  </h3>
  {shipperLoads.length === 0 ? (
    <p className="text-xs text-zinc-600">No loads booked yet.</p>
  ) : (
    <div className="space-y-1">
      {shipperLoads.map((l) => (
        <div key={l.id} className="flex justify-between text-xs font-mono py-1.5 px-3 bg-zinc-900 rounded">
          <span className="text-zinc-200">{l.consignee_name} — {l.dest_city}, {l.dest_state}</span>
          <span className="text-zinc-500">{fmtDate(l.pickup_date)} · {fmtMoney(l.rate_cents)}</span>
        </div>
      ))}
    </div>
  )}
</section>
```

(Define `fmtMoney` / `fmtDate` at top of file or import from a shared util.)

**Verify:** Open any contact that has a load → loads section renders the load.

---

## How to test the whole unit

1. Restart the app fresh. Startup check should be all green.
2. Press `⌘2` to open Contacts. Open any contact (or create one if empty). Note its name.
3. Press `⌘⇧L` to open the Quick Load modal.
4. Fill in: Consignee=`Sysco Houston`, Dest=`Houston`, `TX`. Type 3 letters of your contact's name in the Shipper field → click the autocomplete result.
5. Order # = `PO-12345`, Commodity = `Romaine`, Weight = `42000`, Pallets = `20`, Rate = `2200`.
6. Press `⌘↵` to save. Toast: "Load saved".
7. Press `⌘4` to open Loads. Your load shows: `Sysco Houston — Houston, TX` with shipper name, commodity, pallets, $2,200 rate.
8. Click on filter chip "Booked" — your load stays. Click "Delivered" — it disappears.
9. Type `sysco` in search — your load appears regardless of status filter.
10. Press `⌘2`, open the shipper contact. Scroll down — "Loads (1)" section shows your new load.
11. The shipper's `relationship_state` should now be `active` (verify via Diagnostics or a SQL query).

If all 11 steps work, Unit 1 is done.

---

## What to tell Claude Code to build this for me

```text
Execute build_manual/01_brokerage_core.md from start to finish. Follow every step in order, run the verification at the bottom of each step before moving to the next, and stop only if a verification fails or you need a decision I haven't pre-answered.

Constraints:
- Stack is fixed: Tauri 2 + React 19 + Turso/libSQL + Zustand. Do not propose alternatives.
- Every schema change goes in src-tauri/src/db.rs as a new apply_vN function plus the version bump in init_schema_async. Do not add tables anywhere else.
- Every Rust command must be registered in src-tauri/src/lib.rs invoke_handler.
- Every new TS interface goes in src/types/index.ts.
- Use chunked TodoWrite to show me progress. Mark each step done as you verify it.
- When you hit Step 11 (sidebar wiring), the Truck icon is already imported by Sidebar.tsx — reuse it for the Loads nav item. Don't add a duplicate import.
- At Step 1, edit docs/BUILD_PLAN.md as specified. That file IS source of truth and the build manual references it.

When done, run the 11-step manual walkthrough at the end of the file and report which steps passed. Do not start Unit 2 — wait for me.
```

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `cargo check` says "no field `total_loads` on contacts" | Schema migration v3 didn't run | Restart the dev exe (Cargo.toml watch will pick it up). Check `schema_migrations` table actually has a row for version=3. If not, manually run the ALTER via Turso shell. |
| Quick Load modal opens but Save does nothing | `create_load` not registered in `lib.rs` invoke_handler | Add it. Tauri commands silently no-op when missing the handler. |
| Save succeeds but shipper relationship_state stays `prospect` | Caching: the UI is reading a stale row. | Refresh the contact detail page. The DB update is correct; just a stale state. |
| Margin shows null even with rate + carrier_pay set | You forgot to pass `carrier_pay_cents` in CreateLoadData | The QuickLoadModal intentionally omits carrier_pay for the 30-sec entry path. Margin will populate once you edit the load to add a carrier pay. |
| `relationship_state = 'active'` on a load that was cancelled | Side-effect runs on insert before status is known | Acceptable — if you cancel a load and the shipper has no other loads, you can manually demote them. For v2 we can add a trigger that recomputes relationship_state from `total_loads + last_load_at`. |
| `GENERATED ALWAYS AS` syntax errors on Turso | libSQL supports VIRTUAL generated columns but not STORED | The schema uses VIRTUAL — should work. If it doesn't, change to a regular column updated via a UPDATE trigger or compute in app code. |
| Modal feels slow on the first open | Tauri webview initial render + React state init | Acceptable. First-paint perf can be optimized later — not blocking. |
