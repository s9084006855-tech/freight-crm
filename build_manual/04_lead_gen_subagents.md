# Unit 4 — Lead Generation Subagents

## What you're building

Three cooperating subagents that run in the background to feed your outbound queue:

1. **Discovery agent** — pulls candidate shippers from configured sources (FMCSA SAFER scrape to start, plug-in architecture for DAT / Apollo / LinkedIn later) and inserts unknown ones as `leads`.
2. **Scoring agent** — re-scores all leads on a schedule against your Ideal Shipper Profile (lane match × commodity fit × historical signal × company size proxy), persists the score with a full breakdown so you can tune weights without rerunning.
3. **Sequencing agent** — pulls the top N scored leads, drops them into your outbound queue with an enriched profile + cold-call script (re-uses the existing `enrich.rs` Claude+web_search pattern), respects throttling so you never see more than M leads/day.

All three agents coordinate via shared DB tables, never direct calls. Adding a fourth agent later means writing one Rust module and a row in `lead_sources` — no agent loop to rewrite.

---

## Prerequisites

- [x] Units 1, 2, 3 complete
- [x] At least 50 contacts in the system (the scoring agent needs historical signal to be useful)
- [x] Anthropic API key saved (Discovery + Sequencing both call Claude)
- [x] On a branch: `git checkout -b feature/unit-4-lead-gen`
- [x] You've read the audit's Conflict 2 (model constants) and Conflict 4 (enrichment_data JSON access)

---

## Architecture overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ DiscoveryAgent  │     │  ScoringAgent   │     │ SequencingAgent │
│ (find shippers) │     │ (rank leads)    │     │ (queue + enrich)│
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │ INSERT                │ UPDATE                │ READ + UPDATE
         ▼                       ▼                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Shared DB tables                             │
│                                                                   │
│  leads             — every candidate, denormalized for scoring   │
│  lead_scores       — append-only history (for tuning weights)    │
│  lead_sources      — registered discovery sources                │
│  subagent_runs     — observability + last-run timestamps         │
│  outbound_queue    — what gets surfaced to Francisco             │
└──────────────────────────────────────────────────────────────────┘
```

Each agent is a single Rust module that:
1. Reads its inputs from DB tables
2. Does its work (HTTP call, scoring math, Claude call)
3. Writes results to DB tables
4. Records a row in `subagent_runs` with status, count, duration, error if any

Agents are invoked by Tauri commands (manual trigger from a dashboard) and by a tokio interval timer started in `lib.rs` (autonomous mode, off by default).

---

## Step-by-step build

### Step 1: Extract Claude model constants

**File to create:** `src-tauri/src/claude.rs`

```rust
//! Single source of truth for Anthropic model IDs and API version.
//! All Claude calls in this crate should import from here.

pub const OPUS: &str = "claude-opus-4-7";
pub const SONNET: &str = "claude-sonnet-4-6";
pub const HAIKU: &str = "claude-haiku-4-5-20251001";

pub const API_VERSION: &str = "2023-06-01";
pub const API_URL: &str = "https://api.anthropic.com/v1/messages";

/// Default for medium-complexity structured-extraction tasks.
pub const DEFAULT_MODEL: &str = SONNET;
/// Cheap fast path — bulk enrichment, simple classifications.
pub const BUDGET_MODEL: &str = HAIKU;
```

**File to modify:** `src-tauri/src/lib.rs`

Add `mod claude;` near the top.

**File to modify:** `src-tauri/src/commands/ocr.rs`, `src-tauri/src/commands/enrich.rs`

Replace hardcoded `"claude-sonnet-4-6"`, `"claude-haiku-4-5-..."`, and the API URL constants with imports from `crate::claude`.

**Verify:** `cargo check` passes.

---

### Step 2: Lead Gen tables (v6 migration)

**File to modify:** `src-tauri/src/db.rs`

```rust
async fn apply_v6(conn: &libsql::Connection) -> Result<(), libsql::Error> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS lead_sources (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL UNIQUE,
                -- e.g. 'fmcsa_safer', 'apollo', 'manual_csv', 'linkedin_scrape'
            config_json     TEXT NOT NULL DEFAULT '{}',
                -- per-source config (API key location, filters, etc.)
            enabled         INTEGER NOT NULL DEFAULT 1,
            last_run_at     INTEGER,
            last_run_count  INTEGER,
            created_at      INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS leads (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            -- Source attribution
            source_id           INTEGER REFERENCES lead_sources(id) ON DELETE SET NULL,
            source_record_id    TEXT,        -- the source's own ID, used for dedup
            -- Identity
            company_name        TEXT NOT NULL,
            company_name_search TEXT NOT NULL,
            website             TEXT,
            phone               TEXT,
            phone_normalized    TEXT,
            email               TEXT,
            city                TEXT,
            state               TEXT,
            zip                 TEXT,
            -- Freight-specific signals
            commodity_hints     TEXT,        -- comma-separated guesses from source data
            role_hint           TEXT,        -- shipper | receiver | broker | carrier | unknown
            usdot_number        TEXT,
            mc_number           TEXT,
            -- Raw payload from the source (for re-scoring without re-fetching)
            raw_payload         TEXT NOT NULL DEFAULT '{}',
            -- Lifecycle
            status              TEXT NOT NULL DEFAULT 'new',
                -- new | scored | queued | promoted | rejected
            promoted_to_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
            rejected_reason     TEXT,
            -- Cached current score (for fast filtering — full history in lead_scores)
            current_score       REAL,
            scored_at           INTEGER,
            created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_source_record
            ON leads(source_id, source_record_id) WHERE source_record_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_lead_status ON leads(status);
        CREATE INDEX IF NOT EXISTS idx_lead_score  ON leads(current_score DESC);
        CREATE INDEX IF NOT EXISTS idx_lead_search ON leads(company_name_search);
        CREATE INDEX IF NOT EXISTS idx_lead_phone  ON leads(phone_normalized);

        CREATE TABLE IF NOT EXISTS lead_scores (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id       INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
            score         REAL NOT NULL,
            -- Per-component breakdown as JSON: { 'lane_match': 0.8, 'commodity_fit': 0.6, ... }
            breakdown_json TEXT NOT NULL,
            -- Weights snapshot used (so we can re-score with new weights without losing history)
            weights_json  TEXT NOT NULL,
            scored_at     INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_lead_scores_lead ON lead_scores(lead_id, scored_at DESC);

        CREATE TABLE IF NOT EXISTS outbound_queue (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id       INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
            score_at_queue REAL NOT NULL,
            enrichment_json TEXT,  -- result from sequencing agent (cold-call script etc.)
            queued_at     INTEGER NOT NULL DEFAULT (unixepoch()),
            actioned_at   INTEGER,
            action        TEXT,    -- promoted | rejected | snoozed
            snooze_until  INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_oq_lead ON outbound_queue(lead_id);
        CREATE INDEX IF NOT EXISTS idx_oq_pending ON outbound_queue(actioned_at) WHERE actioned_at IS NULL;

        CREATE TABLE IF NOT EXISTS subagent_runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_name    TEXT NOT NULL,   -- 'discovery' | 'scoring' | 'sequencing'
            started_at    INTEGER NOT NULL DEFAULT (unixepoch()),
            finished_at   INTEGER,
            status        TEXT NOT NULL DEFAULT 'running',  -- running | success | error
            items_in      INTEGER,
            items_out     INTEGER,
            error_message TEXT,
            meta_json     TEXT  -- arbitrary per-agent metrics
        );
        CREATE INDEX IF NOT EXISTS idx_sar_agent ON subagent_runs(agent_name, started_at DESC);

        -- Seed default sources
        INSERT OR IGNORE INTO lead_sources (name, config_json) VALUES
            ('manual_csv',    '{}'),
            ('fmcsa_safer',   '{\"states\": [\"CA\", \"FL\", \"TX\", \"AZ\"], \"role\": \"shipper\"}');
    ").await?;
    Ok(())
}
```

Wire it up in `init_schema_async`.

**Verify:** `SELECT name FROM lead_sources` returns the two seeded rows.

---

### Step 3: Scoring weights config (in app_settings)

Seed default weights at boot in `lib.rs` (same place as the Unit 3 step 1 settings):

```rust
let _ = conn.execute(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES
        ('scoring_weights', '{\"lane_match\":0.35, \"commodity_fit\":0.25, \"size_proxy\":0.15, \"history\":0.15, \"freshness\":0.10}')",
    (),
).await;
let _ = conn.execute(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES
        ('ideal_shipper_profile', '{\"target_lanes\":[\"CA-TX\",\"FL-NY\",\"AZ-IL\"], \"target_commodities\":[\"lettuce\",\"romaine\",\"citrus\",\"melon\",\"berry\"], \"avoid_commodities\":[\"hazmat\",\"livestock\"]}')",
    (),
).await;
```

**Decision: initial weights.** These are starting values. Tunable from a Settings panel in step 9.

---

### Step 4: Agent loop architecture — `subagents.rs` module skeleton

**File to create:** `src-tauri/src/subagents/mod.rs`

```rust
//! Lead generation subagents. Each agent is a single function `run(state)`
//! that reads inputs from DB tables, does work, writes outputs to DB tables,
//! and records a row in `subagent_runs`. Agents never call each other directly.

pub mod discovery;
pub mod scoring;
pub mod sequencing;

use crate::AppState;
use serde_json::Value;
use tauri::AppHandle;

/// Common harness used by every agent. Records a subagent_runs row.
pub async fn record_run<F, Fut>(
    state: &AppState,
    agent_name: &str,
    inner: F,
) -> Result<(i64, i64), String>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<(i64, i64, Value), String>>,
{
    let conn = state.conn()?;
    let started_at = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO subagent_runs (agent_name, started_at, status) VALUES (?1, ?2, 'running')",
        libsql::params![agent_name, started_at],
    ).await.map_err(|e| e.to_string())?;
    let run_id = crate::db::last_insert_rowid(&conn).await?;

    let result = inner().await;

    let now = chrono::Utc::now().timestamp();
    match &result {
        Ok((items_in, items_out, meta)) => {
            conn.execute(
                "UPDATE subagent_runs SET finished_at=?1, status='success', items_in=?2, items_out=?3, meta_json=?4 WHERE id=?5",
                libsql::params![now, items_in, items_out, meta.to_string(), run_id],
            ).await.map_err(|e| e.to_string())?;
            Ok((*items_in, *items_out))
        }
        Err(e) => {
            conn.execute(
                "UPDATE subagent_runs SET finished_at=?1, status='error', error_message=?2 WHERE id=?3",
                libsql::params![now, e.clone(), run_id],
            ).await.map_err(|e| e.to_string())?;
            Err(e.clone())
        }
    }
}

pub fn emit_progress(app: &AppHandle, agent: &str, payload: Value) {
    use tauri::Emitter;
    let _ = app.emit(&format!("subagent-progress-{}", agent), payload);
}
```

In `src-tauri/src/lib.rs`: `mod subagents;` near top.

---

### Step 5: Discovery agent — FMCSA SAFER scrape

**File to create:** `src-tauri/src/subagents/discovery.rs`

```rust
//! Discovery agent — finds candidate shippers.
//!
//! v1 source: FMCSA SAFER public registry (https://safer.fmcsa.dot.gov).
//! Scrapes by state + entity type. Free, no auth, rate-limited politely.
//!
//! Plug-in architecture: add a new source by:
//!   1. Inserting a row in lead_sources with a unique name + config_json
//!   2. Adding a `match` arm here that dispatches to a new module
//!   3. That module implements `async fn run(config: Value) -> Vec<LeadDraft>`

use crate::AppState;
use crate::db::{normalize_company, normalize_phone};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct LeadDraft {
    pub source_record_id: String,
    pub company_name: String,
    pub website: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub usdot_number: Option<String>,
    pub mc_number: Option<String>,
    pub role_hint: Option<String>,
    pub commodity_hints: Option<String>,
    pub raw_payload: Value,
}

#[tauri::command]
pub async fn run_discovery(
    state: State<'_, AppState>,
    app: AppHandle,
    source_name: Option<String>,
) -> Result<i64, String> {
    let (_, items_out) = super::record_run(&state, "discovery", || async {
        let conn = state.conn()?;

        // Pick sources to run
        let where_clause = match &source_name {
            Some(_) => " WHERE enabled = 1 AND name = ?1",
            None    => " WHERE enabled = 1",
        };
        let sql = format!(
            "SELECT id, name, config_json FROM lead_sources{}",
            where_clause
        );

        let mut rows = match &source_name {
            Some(n) => conn.query(&sql, libsql::params![n.clone()]).await,
            None    => conn.query(&sql, ()).await,
        }.map_err(|e| e.to_string())?;

        let mut total_inserted = 0i64;
        let mut total_seen = 0i64;
        let mut sources_run = vec![];

        while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
            let source_id = row.get::<i64>(0).map_err(|e| e.to_string())?;
            let name = row.get::<String>(1).map_err(|e| e.to_string())?;
            let config_str = row.get::<String>(2).map_err(|e| e.to_string())?;
            let config: Value = serde_json::from_str(&config_str).unwrap_or(json!({}));

            super::emit_progress(&app, "discovery", json!({"source": name, "phase": "started"}));

            let drafts = match name.as_str() {
                "fmcsa_safer" => fmcsa_safer::run(config).await.unwrap_or_default(),
                "manual_csv"  => Vec::new(), // handled via Import Hub, not here
                _ => Vec::new(),
            };

            total_seen += drafts.len() as i64;
            let inserted = insert_drafts(&conn, source_id, &drafts).await?;
            total_inserted += inserted;

            // Update lead_sources stats
            let now = chrono::Utc::now().timestamp();
            let _ = conn.execute(
                "UPDATE lead_sources SET last_run_at=?1, last_run_count=?2 WHERE id=?3",
                libsql::params![now, inserted, source_id],
            ).await;

            sources_run.push(json!({"name": name, "seen": drafts.len(), "inserted": inserted}));
            super::emit_progress(&app, "discovery", json!({"source": name, "phase": "done", "inserted": inserted}));
        }

        Ok((total_seen, total_inserted, json!({"sources": sources_run})))
    }).await?;

    Ok(items_out)
}

async fn insert_drafts(
    conn: &libsql::Connection,
    source_id: i64,
    drafts: &[LeadDraft],
) -> Result<i64, String> {
    let mut inserted = 0i64;
    for d in drafts {
        let search = normalize_company(&d.company_name);
        let phone_norm = d.phone.as_deref().map(normalize_phone);
        let raw = d.raw_payload.to_string();
        // INSERT OR IGNORE on (source_id, source_record_id) — dedup by source identity
        let res = conn.execute(
            "INSERT OR IGNORE INTO leads (
                source_id, source_record_id, company_name, company_name_search,
                website, phone, phone_normalized, email, city, state, zip,
                commodity_hints, role_hint, usdot_number, mc_number, raw_payload
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            libsql::params![
                source_id, d.source_record_id.clone(),
                d.company_name.clone(), search,
                d.website, d.phone, phone_norm, d.email,
                d.city, d.state, d.zip,
                d.commodity_hints, d.role_hint,
                d.usdot_number, d.mc_number,
                raw,
            ],
        ).await.map_err(|e| e.to_string())?;
        if res > 0 { inserted += 1; }
    }
    Ok(inserted)
}

// ── Source: FMCSA SAFER ───────────────────────────────────────────────

mod fmcsa_safer {
    use super::{LeadDraft, Value};
    use serde_json::json;

    /// Config shape: { "states": ["CA","TX"], "role": "shipper" }
    pub async fn run(config: Value) -> Result<Vec<LeadDraft>, String> {
        // FMCSA's SAFER doesn't have a clean JSON API, but you can scrape
        // the HTML or use the publicly-released SAFER Company Snapshot CSVs.
        //
        // SCAFFOLD: replace this stub with real scraping logic.
        // The interim shape gives the rest of the pipeline data to work with.
        //
        // TODO #1: Pick scrape strategy. Two options:
        //   (a) Download FMCSA's monthly CSV dump (~1GB, 1.8M carriers/shippers).
        //       Filter to entity_type='S' (shipper). Pros: bulk, no rate limits.
        //       Cons: large file, monthly cadence.
        //       Source: https://ai.fmcsa.dot.gov/SMS/
        //   (b) Scrape SAFER search results by state + entity_type.
        //       Pros: live. Cons: HTML scraping, fragile, rate-limited.
        //       Endpoint: https://safer.fmcsa.dot.gov/CompanySnapshot.aspx
        //
        // RECOMMENDED: (a) for v1. Run once a month. Add a cron later.
        //
        // For Unit 4 step 5 we return a tiny mocked sample so downstream
        // agents can be built and verified. Replace this when you wire up the
        // real source per the TODO above.

        let states = config["states"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<_>>())
            .unwrap_or_else(|| vec!["CA".into(), "TX".into()]);

        let mut out = Vec::new();
        for state in &states {
            out.push(LeadDraft {
                source_record_id: format!("safer-mock-{}-1", state),
                company_name: format!("Sample Produce LLC ({})", state),
                website: Some("https://example.com".into()),
                phone: Some("5551234567".into()),
                email: None,
                city: Some("Salinas".into()),
                state: Some(state.clone()),
                zip: None,
                usdot_number: Some("1234567".into()),
                mc_number: Some("MC987654".into()),
                role_hint: Some("shipper".into()),
                commodity_hints: Some("lettuce,romaine".into()),
                raw_payload: json!({"mock": true, "state": state}),
            });
        }
        Ok(out)
    }
}
```

**TODO inline:** Replace the `fmcsa_safer::run` body with real scraping when ready. The mock data lets the rest of Unit 4 be testable.

Register the command:
```rust
// in src-tauri/src/lib.rs invoke_handler
subagents::discovery::run_discovery,
```

---

### Step 6: Scoring agent

**File to create:** `src-tauri/src/subagents/scoring.rs`

```rust
//! Scoring agent — ranks leads against the Ideal Shipper Profile.
//!
//! Re-runs from scratch every time (cheap, all in-DB). Persists each score
//! into lead_scores so we can audit / tune / replay.

use crate::AppState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::{AppHandle, State};

#[derive(Debug, Deserialize)]
struct Weights {
    lane_match: f64,
    commodity_fit: f64,
    size_proxy: f64,
    history: f64,
    freshness: f64,
}

#[derive(Debug, Deserialize)]
struct IdealProfile {
    target_lanes: Vec<String>,        // e.g. ["CA-TX", "FL-NY"]
    target_commodities: Vec<String>,  // ["lettuce", "romaine"]
    avoid_commodities: Vec<String>,
}

#[tauri::command]
pub async fn run_scoring(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<i64, String> {
    let (_, scored) = super::record_run(&state, "scoring", || async {
        let conn = state.conn()?;
        let weights = load_weights(&conn).await?;
        let profile = load_profile(&conn).await?;
        let now = chrono::Utc::now().timestamp();

        // Pull every lead in 'new' or 'scored' status (skip queued/promoted/rejected)
        let mut rows = conn.query(
            "SELECT id, company_name_search, state, commodity_hints, raw_payload
             FROM leads WHERE status IN ('new', 'scored')",
            (),
        ).await.map_err(|e| e.to_string())?;

        let mut all: Vec<(i64, String, Option<String>, Option<String>, String)> = vec![];
        while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
            all.push((
                row.get::<i64>(0).map_err(|e| e.to_string())?,
                row.get::<String>(1).map_err(|e| e.to_string())?,
                row.get::<Option<String>>(2).ok().flatten(),
                row.get::<Option<String>>(3).ok().flatten(),
                row.get::<String>(4).map_err(|e| e.to_string())?,
            ));
        }

        let total_in = all.len() as i64;
        let weights_json = serde_json::to_string(&serde_json::json!({
            "lane_match": weights.lane_match,
            "commodity_fit": weights.commodity_fit,
            "size_proxy": weights.size_proxy,
            "history": weights.history,
            "freshness": weights.freshness,
        })).unwrap();

        let mut scored_count = 0i64;
        for (i, (id, _search, state_, commodities, raw_payload)) in all.iter().enumerate() {
            let breakdown = score_one(&profile, state_.as_deref(), commodities.as_deref(), raw_payload);
            let score = weights.lane_match * breakdown["lane_match"].as_f64().unwrap_or(0.0)
                      + weights.commodity_fit * breakdown["commodity_fit"].as_f64().unwrap_or(0.0)
                      + weights.size_proxy * breakdown["size_proxy"].as_f64().unwrap_or(0.0)
                      + weights.history * breakdown["history"].as_f64().unwrap_or(0.0)
                      + weights.freshness * breakdown["freshness"].as_f64().unwrap_or(0.0);

            conn.execute(
                "INSERT INTO lead_scores (lead_id, score, breakdown_json, weights_json, scored_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                libsql::params![*id, score, breakdown.to_string(), weights_json.clone(), now],
            ).await.map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE leads SET current_score=?1, scored_at=?2, status='scored', updated_at=?2 WHERE id=?3",
                libsql::params![score, now, *id],
            ).await.map_err(|e| e.to_string())?;

            scored_count += 1;
            if i % 25 == 0 {
                super::emit_progress(&app, "scoring", json!({"done": i, "total": total_in}));
            }
        }
        super::emit_progress(&app, "scoring", json!({"done": total_in, "total": total_in, "phase": "complete"}));

        Ok((total_in, scored_count, json!({"weights": weights_json})))
    }).await?;

    Ok(scored)
}

fn score_one(profile: &IdealProfile, state: Option<&str>, commodity_hints: Option<&str>, _raw_payload: &str) -> Value {
    // 1. Lane match — does this lead's state match any of our target lane endpoints?
    let lane_match = match state {
        Some(st) => {
            let st_up = st.to_uppercase();
            let mut hit = false;
            for lane in &profile.target_lanes {
                if lane.contains(&st_up) { hit = true; break; }
            }
            if hit { 1.0 } else { 0.2 }
        }
        None => 0.5,
    };

    // 2. Commodity fit — overlap with target list, penalize avoid list
    let commodity_fit = match commodity_hints {
        Some(c) => {
            let lower = c.to_lowercase();
            let mut score: f64 = 0.0;
            for tgt in &profile.target_commodities {
                if lower.contains(&tgt.to_lowercase()) { score += 0.3; }
            }
            for av in &profile.avoid_commodities {
                if lower.contains(&av.to_lowercase()) { score -= 0.5; }
            }
            score.clamp(0.0, 1.0)
        }
        None => 0.3,
    };

    // 3. Size proxy — placeholder, will improve when raw_payload has volume hints
    //    For now, return 0.5 as a neutral.
    let size_proxy = 0.5;

    // 4. History — has this company been seen in our `contacts` table before?
    //    If yes and they have loads → boost. If yes and rejected → penalize.
    //    Placeholder for now (needs another DB lookup; do in v2 of this agent).
    let history = 0.5;

    // 5. Freshness — newer leads score higher (decay over 90 days)
    //    For now, treat all as fresh (=1.0). Add real decay in v2.
    let freshness = 1.0;

    json!({
        "lane_match": lane_match,
        "commodity_fit": commodity_fit,
        "size_proxy": size_proxy,
        "history": history,
        "freshness": freshness,
    })
}

async fn load_weights(conn: &libsql::Connection) -> Result<Weights, String> {
    let mut r = conn.query(
        "SELECT value FROM app_settings WHERE key='scoring_weights'",
        (),
    ).await.map_err(|e| e.to_string())?;
    let row = r.next().await.map_err(|e| e.to_string())?.ok_or("scoring_weights not set")?;
    let json = row.get::<String>(0).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

async fn load_profile(conn: &libsql::Connection) -> Result<IdealProfile, String> {
    let mut r = conn.query(
        "SELECT value FROM app_settings WHERE key='ideal_shipper_profile'",
        (),
    ).await.map_err(|e| e.to_string())?;
    let row = r.next().await.map_err(|e| e.to_string())?.ok_or("ideal_shipper_profile not set")?;
    let json = row.get::<String>(0).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

// (unused import warning suppression — HashMap was used in an earlier draft)
#[allow(dead_code)]
fn _unused() { let _: HashMap<String, String> = HashMap::new(); }
```

Register: `subagents::scoring::run_scoring` in lib.rs.

---

### Step 7: Sequencing agent

**File to create:** `src-tauri/src/subagents/sequencing.rs`

```rust
//! Sequencing agent — picks the top-N scored leads, drops them into
//! outbound_queue, and enriches each with a Claude-generated profile +
//! cold-call script (re-uses the pattern from enrich.rs).

use crate::AppState;
use crate::claude::{BUDGET_MODEL, API_URL, API_VERSION};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

const DAILY_THROTTLE: i64 = 10; // max leads queued per day, prevents Claude bill blowup

#[tauri::command]
pub async fn run_sequencing(
    state: State<'_, AppState>,
    app: AppHandle,
    take: Option<i64>,
) -> Result<i64, String> {
    let (_, queued_count) = super::record_run(&state, "sequencing", || async {
        let conn = state.conn()?;
        let api_key = crate::commands::keychain::get_raw_api_key()
            .ok_or("No API key — add it in Settings")?;
        let now = chrono::Utc::now().timestamp();
        let today_start = now - (now % 86400);

        let already_today: i64 = {
            let mut r = conn.query(
                "SELECT COUNT(*) FROM outbound_queue WHERE queued_at >= ?1",
                libsql::params![today_start],
            ).await.map_err(|e| e.to_string())?;
            r.next().await.map_err(|e| e.to_string())?
                .and_then(|row| row.get::<i64>(0).ok()).unwrap_or(0)
        };
        let remaining_today = (DAILY_THROTTLE - already_today).max(0);
        let take = take.unwrap_or(remaining_today).min(remaining_today);

        if take == 0 {
            return Ok((0, 0, json!({"reason": "daily throttle reached"})));
        }

        // Top scored leads that aren't already queued/promoted/rejected
        let mut rows = conn.query(
            "SELECT l.id, l.company_name, l.state, l.city, l.commodity_hints,
                    l.role_hint, l.current_score
             FROM leads l
             LEFT JOIN outbound_queue oq ON oq.lead_id = l.id
             WHERE l.status = 'scored'
               AND oq.id IS NULL
             ORDER BY l.current_score DESC, l.created_at DESC
             LIMIT ?1",
            libsql::params![take],
        ).await.map_err(|e| e.to_string())?;

        let mut leads = vec![];
        while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
            leads.push((
                row.get::<i64>(0).map_err(|e| e.to_string())?,
                row.get::<String>(1).map_err(|e| e.to_string())?,
                row.get::<Option<String>>(2).ok().flatten(),
                row.get::<Option<String>>(3).ok().flatten(),
                row.get::<Option<String>>(4).ok().flatten(),
                row.get::<Option<String>>(5).ok().flatten(),
                row.get::<Option<f64>>(6).ok().flatten().unwrap_or(0.0),
            ));
        }

        let total_in = leads.len() as i64;
        let mut queued = 0i64;
        for (i, (lead_id, name, state_, city, comm, role, score)) in leads.iter().enumerate() {
            super::emit_progress(&app, "sequencing", json!({
                "done": i, "total": total_in, "current": name
            }));

            let enrichment = enrich_one(&api_key, name, state_.as_deref(), city.as_deref(),
                                         comm.as_deref(), role.as_deref()).await
                .unwrap_or_else(|e| json!({"error": e}));

            conn.execute(
                "INSERT INTO outbound_queue (lead_id, score_at_queue, enrichment_json, queued_at)
                 VALUES (?1, ?2, ?3, ?4)",
                libsql::params![*lead_id, *score, enrichment.to_string(), now],
            ).await.map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE leads SET status='queued', updated_at=?1 WHERE id=?2",
                libsql::params![now, *lead_id],
            ).await.map_err(|e| e.to_string())?;
            queued += 1;
        }

        super::emit_progress(&app, "sequencing", json!({"done": total_in, "total": total_in, "phase": "complete"}));
        Ok((total_in, queued, json!({"daily_throttle_remaining": (DAILY_THROTTLE - already_today - queued).max(0)})))
    }).await?;

    Ok(queued_count)
}

async fn enrich_one(
    api_key: &str,
    name: &str,
    state_: Option<&str>,
    city: Option<&str>,
    commodity_hints: Option<&str>,
    role_hint: Option<&str>,
) -> Result<Value, String> {
    let body = json!({
        "model": BUDGET_MODEL,
        "max_tokens": 800,
        "system": [{
            "type": "text",
            "text": "You are a produce-freight broker's research assistant. For each company name, return a JSON object with: profile (1-2 sentences), key_contact_title, cold_call_script (under 80 words, opens with a hook, qualifies, closes with a value offer not a question). Output JSON only.",
            "cache_control": { "type": "ephemeral" }
        }],
        "messages": [{
            "role": "user",
            "content": format!(
                "Company: {}\nLocation: {}, {}\nLikely role: {}\nLikely commodities: {}",
                name,
                city.unwrap_or(""),
                state_.unwrap_or(""),
                role_hint.unwrap_or("unknown"),
                commodity_hints.unwrap_or("unknown")
            )
        }]
    });

    let client = reqwest::Client::new();
    let resp = client.post(API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send().await.map_err(|e| e.to_string())?;

    let text = resp.text().await.map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

    let content = v["content"].as_array()
        .and_then(|arr| arr.iter().find(|b| b["type"] == "text"))
        .and_then(|b| b["text"].as_str())
        .unwrap_or("{}")
        .trim();

    // Strip code fences if Claude returned them
    let cleaned = content
        .strip_prefix("```json").or_else(|| content.strip_prefix("```")).unwrap_or(content)
        .strip_suffix("```").unwrap_or(content)
        .trim();

    serde_json::from_str(cleaned).map_err(|e| format!("Bad enrichment JSON: {} | raw: {}", e, content))
}
```

Register: `subagents::sequencing::run_sequencing`.

---

### Step 8: Outbound Queue view

**File to create:** `src/views/QueueView.tsx`

Shows pending outbound queue rows: company name, score, hook, "Call now → log call" button, "Reject" button, "Snooze 7d" button. Each action updates `outbound_queue.actioned_at + action`.

```tsx
// Skeleton — Claude Code can fill in details following the RetentionView pattern.
// Key invokes:
//   invoke("get_outbound_queue", { limit: 20 })  // pending only
//   invoke("action_queue_item", { id, action: "promoted" | "rejected" | "snoozed", snoozeDays?: number })
//
// On "promoted" — backend creates a contacts row from the lead, links it,
// updates lead.status='promoted' and outbound_queue.actioned_at=now.
```

(Implement `get_outbound_queue` and `action_queue_item` Rust commands following the patterns from `import.rs` for promotion — it should reuse `create_contact` internally.)

Add to sidebar (`Queue`, shortcut `⌘7`) and router.

---

### Step 9: Tuning panel for weights + ideal profile

**File to modify:** `src/views/SettingsView.tsx`

Add a section "Lead scoring":
- Sliders / number inputs for each of the 5 weights (must sum to 1.0; show a warning if not)
- Multiselect chip inputs for `target_lanes`, `target_commodities`, `avoid_commodities`
- "Re-score now" button that calls `run_scoring`

Persist via `update_setting` (key=`scoring_weights` or `ideal_shipper_profile`, value=JSON.stringify(...)).

---

### Step 10: Subagent dashboard

**File to create:** `src/views/SubagentsView.tsx`

A debug/observability page (sidebar `⌘8` or under Diagnostics):
- Manual run buttons: "Run Discovery", "Run Scoring", "Run Sequencing"
- Live progress (listen to `subagent-progress-discovery|scoring|sequencing` events)
- Recent runs table (last 20 rows from `subagent_runs`): agent, started, finished, status, items in/out, error
- Counters: leads (by status), queue (pending vs actioned)

---

### Step 11: Adding a fourth agent later (instructions only)

Document the contract in a comment at the top of `src-tauri/src/subagents/mod.rs`:

```rust
//! ## Adding a new agent
//!
//! 1. Create `src-tauri/src/subagents/<name>.rs`
//! 2. Implement one `#[tauri::command] pub async fn run_<name>(state, app, ...) -> Result<i64, String>`
//!    that wraps its body in `super::record_run(&state, "<name>", || async { ... }).await`
//! 3. Add `pub mod <name>;` to this file
//! 4. Register the command in src-tauri/src/lib.rs invoke_handler
//! 5. Add a button + progress listener in SubagentsView.tsx
//!
//! Agents communicate only via DB tables — never call each other directly.
//! New tables: namespace them with `<unit>_` prefix.
```

---

## How to test the whole unit

1. From SubagentsView (`⌘8`), click **Run Discovery**. Progress event flashes. `subagent_runs` shows a new row, status=success. `leads` table has rows (2 mock rows from the FMCSA scaffold).
2. Click **Run Scoring**. Each lead gets `current_score` set. `lead_scores` has a row per lead.
3. Open the leads table via DB shell or a quick page. Sort by `current_score DESC`. The CA-based mock should outscore others (lane_match=1.0 vs 0.2).
4. Click **Run Sequencing**. Outbound_queue gains a row. Lead.status flips to `queued`. The enrichment_json contains profile + cold_call_script from Claude Haiku.
5. Open Queue view (`⌘7`). The lead appears with company name, score, cold-call script in a card.
6. Click **Call now → log call**. QuickCallModal opens for the promoted contact. Log a call. Activity appears under the contact.
7. Click **Reject** on another lead. Lead status → rejected. Disappears from queue.
8. Click **Snooze 7d**. snooze_until=now+7d. Lead disappears from queue but stays in `leads`.
9. Run **Sequencing** again immediately. Throttle kicks in — message says "daily throttle reached". 0 new queue rows.
10. In Settings → Lead Scoring, change `target_commodities` (remove "lettuce"). Save. Click **Re-score now**. `lead_scores` gets new rows with new weights snapshot. Lead scores change.
11. Verify in `subagent_runs` that you can see the full history: discovery x1, scoring x2, sequencing x1.

If all 11 steps work, Unit 4 is done. (Real FMCSA wiring is a follow-up task — see TODO in `discovery.rs`.)

---

## What to tell Claude Code to build this for me

```text
Execute build_manual/04_lead_gen_subagents.md from start to finish. Units 1-3 must already be merged.

Constraints:
- Stack is fixed: Tauri 2 + React 19 + Turso/libSQL + Anthropic API.
- All schema changes in src-tauri/src/db.rs apply_v6.
- Use the model constants in src-tauri/src/claude.rs created in Step 1 — do not hardcode model IDs elsewhere.
- The FMCSA SAFER scrape body in Step 5 stays as scaffold/mock. Do NOT attempt to implement real SAFER scraping in this unit — the TODO comment explains the path forward.
- DAILY_THROTTLE in Step 7 stays at 10. Tunable later in Settings if needed.
- Step 8 (Queue view) — write a full implementation, not skeleton. Use the RetentionView from Unit 3 as the structural model.
- Step 9 — implement the full Settings panel for weights and profile.
- Step 10 — implement the SubagentsView fully.
- Use TodoWrite to mark each step.
- Run the 11-step walkthrough. Report passes/fails. Stop before Unit 5.
```

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `run_discovery` succeeds but 0 leads inserted | Mock data was inserted on a previous run; `INSERT OR IGNORE` skips dupes | This is correct behavior. Delete the mock rows (`DELETE FROM leads WHERE source_record_id LIKE 'safer-mock-%'`) and re-run. |
| Scoring agent panics with "scoring_weights not set" | Settings seed in Step 3 didn't run (timing race with auto-reconnect) | Manually insert via Diagnostics: `INSERT INTO app_settings (key, value) VALUES ('scoring_weights', '{...}')`. |
| Sequencing returns "daily throttle reached" first run | Earlier test runs queued items today | Wait until tomorrow OR temporarily set `DAILY_THROTTLE` higher. |
| Claude enrichment returns non-JSON | System prompt isn't strict enough | The strip_code_fences fallback handles ```json wraps. If still failing, log the raw text and tighten the system prompt to add "Return ONLY a JSON object. No markdown. No prose." |
| Lead scores all the same | Profile or weights JSON is malformed (parses but fields missing) | Validate via Settings UI before saving — refuse invalid JSON. |
| Adding a new agent requires renaming subagent_runs columns | Schema bound too tightly to current agents | The schema uses `agent_name` as a string + `meta_json` blob — adding new agents needs zero schema changes. |
| Promoting a lead creates a duplicate contact | Promotion logic doesn't check `contacts.phone_normalized` against the lead's phone | In `action_queue_item` handler, look up existing contact by normalized phone first; if found, link the lead to that contact instead of creating a new one. |
