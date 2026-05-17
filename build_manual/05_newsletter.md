# Unit 5 — Newsletter

## What you're building

A daily-notes inbox where you jot one-liners throughout the day (a weird load, a lane shifting, a shipper objection). At any time you can hit "Draft today's issue" — Claude turns the notes into a ~300-word newsletter in your voice. You review/edit in a side-by-side editor, then click Send. Sending fires through Resend to your subscriber list. Drafts and sent issues are stored so you can repurpose them later (Unit 6).

---

## Prerequisites

- [x] Units 1–4 complete
- [x] Resend account created → `RESEND_API_KEY` available (free tier: 100 emails/day, 3K/month)
- [x] A verified sending domain on Resend (e.g. `freight.afuo.com` or `notes.franciscopelaez.com`) — Resend onboarding walks you through DNS records
- [x] On a branch: `git checkout -b feature/unit-5-newsletter`

---

## Step-by-step build

### Step 1: Newsletter tables (v7 migration)

**File to modify:** `src-tauri/src/db.rs`

```rust
async fn apply_v7(conn: &libsql::Connection) -> Result<(), libsql::Error> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS daily_notes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            body        TEXT NOT NULL,
            tags        TEXT,        -- comma-separated free-form
            related_load_id INTEGER REFERENCES loads(id) ON DELETE SET NULL,
            related_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
            used_in_issue_id INTEGER,  -- set after a note feeds an issue
            created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
            user_id     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_dn_created ON daily_notes(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_dn_unused  ON daily_notes(used_in_issue_id) WHERE used_in_issue_id IS NULL;

        CREATE TABLE IF NOT EXISTS newsletter_drafts (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            subject      TEXT NOT NULL,
            body         TEXT NOT NULL,
            -- IDs of notes that were used as source material (JSON array of ints)
            source_note_ids TEXT NOT NULL DEFAULT '[]',
            -- Final issue (after edit + send) is in newsletter_issues
            sent_as_issue_id INTEGER,
            created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS newsletter_issues (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            draft_id      INTEGER REFERENCES newsletter_drafts(id) ON DELETE SET NULL,
            subject       TEXT NOT NULL,
            body          TEXT NOT NULL,
            sent_at       INTEGER NOT NULL,
            recipient_count INTEGER NOT NULL,
            resend_batch_id TEXT,   -- Resend's response id, for ops
            created_at    INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_ni_sent ON newsletter_issues(sent_at DESC);

        CREATE TABLE IF NOT EXISTS subscribers (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            email       TEXT NOT NULL UNIQUE,
            full_name   TEXT,
            company     TEXT,
            -- 'active' | 'unsubscribed' | 'bounced'
            status      TEXT NOT NULL DEFAULT 'active',
            source      TEXT,       -- where did they sign up? 'manual', 'website', 'import_csv'
            unsubscribe_token TEXT UNIQUE,
            subscribed_at INTEGER NOT NULL DEFAULT (unixepoch()),
            unsubscribed_at INTEGER,
            last_sent_at  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_sub_status ON subscribers(status);
    ").await?;
    Ok(())
}
```

Wire in `init_schema_async` (`if current < 7 { apply_v7... }`).

**Verify:** All four tables exist via DB shell.

---

### Step 2: Storage for the Resend API key

The Anthropic key uses the OS credential vault via `keyring`. The Resend key is lower-stakes — store in `local_config.json` alongside Turso creds. Quicker to read, no extra keyring entry.

**File to modify:** `src-tauri/src/lib.rs`

Add to `LocalConfig`:

```rust
#[serde(default)]
pub resend_api_key: String,
#[serde(default)]
pub newsletter_from_email: String,
#[serde(default)]
pub newsletter_from_name: String,
```

Update `load_or_create_local_config` to include the new fields with `String::new()` defaults.

**Verify:** Restart, `local_config.json` now has the three new keys (empty strings).

---

### Step 3: Settings UI for Resend config

**File to modify:** `src/views/SettingsView.tsx`

Add a section above "Anthropic API key":

```tsx
{/* Resend (newsletter sending) */}
<section>
  <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Resend (newsletter)</h2>
  <p className="text-xs text-zinc-600 mb-3">
    From your Resend dashboard at <span className="text-zinc-300">resend.com/api-keys</span>.
    First 3,000 emails/month free.
  </p>
  <div className="space-y-2">
    <input value={resendKey} onChange={(e) => setResendKey(e.target.value)}
      type="password" placeholder="re_..."
      className="w-full h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
    <div className="flex gap-2">
      <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)}
        placeholder="francisco@notes.afuo.com (verified sending domain)"
        className="flex-1 h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
      <input value={fromName} onChange={(e) => setFromName(e.target.value)}
        placeholder="Francisco Pelaez"
        className="flex-1 h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100" />
    </div>
    <button onClick={saveResendConfig}
      className="px-3 py-1.5 text-xs font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded">
      Save
    </button>
  </div>
</section>
```

Backend command: `set_resend_config(api_key, from_email, from_name)` — writes to `local_config.json`.

```rust
#[tauri::command]
pub fn set_resend_config(
    state: tauri::State<AppState>,
    api_key: String,
    from_email: String,
    from_name: String,
) -> Result<(), String> {
    let mut cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
    cfg.resend_api_key = api_key;
    cfg.newsletter_from_email = from_email;
    cfg.newsletter_from_name = from_name;
    let json = serde_json::to_string_pretty(&*cfg).map_err(|e| e.to_string())?;
    std::fs::write(&state.local_cfg_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_resend_config_masked(state: tauri::State<AppState>) -> Result<(Option<String>, String, String), String> {
    let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
    let masked = if cfg.resend_api_key.is_empty() { None }
                 else { Some(format!("re_••••{}", &cfg.resend_api_key[cfg.resend_api_key.len().saturating_sub(4)..])) };
    Ok((masked, cfg.newsletter_from_email.clone(), cfg.newsletter_from_name.clone()))
}
```

Register both in lib.rs invoke handler.

---

### Step 4: Daily-notes commands

**File to create:** `src-tauri/src/commands/notes.rs`

```rust
use crate::AppState;
use crate::db::last_insert_rowid;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyNote {
    pub id: i64,
    pub body: String,
    pub tags: Option<String>,
    pub related_load_id: Option<i64>,
    pub related_contact_id: Option<i64>,
    pub used_in_issue_id: Option<i64>,
    pub created_at: i64,
    pub user_id: Option<String>,
}

#[tauri::command]
pub async fn add_daily_note(
    state: State<'_, AppState>,
    body: String,
    tags: Option<String>,
    related_load_id: Option<i64>,
    related_contact_id: Option<i64>,
    user_id: Option<String>,
) -> Result<DailyNote, String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO daily_notes (body, tags, related_load_id, related_contact_id, user_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        libsql::params![body, tags, related_load_id, related_contact_id, user_id, now],
    ).await.map_err(|e| e.to_string())?;
    let id = last_insert_rowid(&conn).await?;
    fetch_one(&conn, id).await
}

#[tauri::command]
pub async fn get_unused_notes(state: State<'_, AppState>, limit: Option<i64>) -> Result<Vec<DailyNote>, String> {
    let conn = state.conn()?;
    let mut rows = conn.query(
        "SELECT id, body, tags, related_load_id, related_contact_id, used_in_issue_id, created_at, user_id
         FROM daily_notes
         WHERE used_in_issue_id IS NULL
         ORDER BY created_at DESC LIMIT ?1",
        libsql::params![limit.unwrap_or(50)],
    ).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(r) = rows.next().await.map_err(|e| e.to_string())? {
        out.push(row_to_note(&r)?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn delete_daily_note(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute("DELETE FROM daily_notes WHERE id = ?1", libsql::params![id])
        .await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn fetch_one(conn: &libsql::Connection, id: i64) -> Result<DailyNote, String> {
    let mut rows = conn.query(
        "SELECT id, body, tags, related_load_id, related_contact_id, used_in_issue_id, created_at, user_id
         FROM daily_notes WHERE id = ?1",
        libsql::params![id],
    ).await.map_err(|e| e.to_string())?;
    let r = rows.next().await.map_err(|e| e.to_string())?.ok_or("Not found")?;
    row_to_note(&r)
}

fn row_to_note(r: &libsql::Row) -> Result<DailyNote, String> {
    Ok(DailyNote {
        id: r.get::<i64>(0).map_err(|e| e.to_string())?,
        body: r.get::<String>(1).map_err(|e| e.to_string())?,
        tags: r.get::<Option<String>>(2).ok().flatten(),
        related_load_id: r.get::<Option<i64>>(3).ok().flatten(),
        related_contact_id: r.get::<Option<i64>>(4).ok().flatten(),
        used_in_issue_id: r.get::<Option<i64>>(5).ok().flatten(),
        created_at: r.get::<i64>(6).map_err(|e| e.to_string())?,
        user_id: r.get::<Option<String>>(7).ok().flatten(),
    })
}
```

Register in mod.rs + lib.rs. TS wrappers in db.ts.

---

### Step 5: Notes inbox UI (Notes view)

**File to create:** `src/views/NotesView.tsx`

A scratchpad-style page:
- Big textarea at top: "What just happened? (Cmd+Enter to save)"
- Scrollable list below: every unused note with timestamp, delete button
- Sidebar nav: `Notes`, `⌘9`
- Adds new note via `db.addDailyNote(body)`

(Use the PasteParser component as visual reference.)

**Decision: how to attach a note to a load/contact?**
- **(A)** Free-form `[[load:123]]` `[[contact:45]]` syntax parsed at draft time
- **(B)** Dropdown picker when adding the note
- **(C)** Skip linking in v1 — just freeform text

**Recommendation:** C for v1. The Claude prompt has all your load + activity history available if you want to mention specifics; over-structuring the input chills the journaling habit.

---

### Step 6: Claude draft generator

**File to create:** `src-tauri/src/commands/newsletter.rs`

```rust
use crate::AppState;
use crate::claude::{API_URL, API_VERSION, SONNET};
use crate::db::last_insert_rowid;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct Draft {
    pub id: i64,
    pub subject: String,
    pub body: String,
    pub source_note_ids: Vec<i64>,
    pub created_at: i64,
}

const NEWSLETTER_SYSTEM_PROMPT: &str = "You are drafting a daily produce-freight newsletter for Francisco Pelaez, a one-person broker (AFUO, MC 1136566). His voice: direct, on-the-ground, no buzzwords, no exclamation points, no 'just' / 'really'. He writes from the field at 7am — what he saw, what shifted in his lanes, a weird load, a shipper objection and how he handled it. Subscribers are dispatchers, shippers, brokers, owner-operators. They want signal, not motivation.

You will receive his daily notes (one-liners he jotted throughout the day). Pick the ONE most interesting / instructive item and build a single short post around it. Use the other notes only as supporting color if they relate.

OUTPUT FORMAT — strict JSON:
{
  \"subject\": \"<8-12 words, lowercase, conversational, no clickbait>\",
  \"body\": \"<280-340 words, plain text only, no markdown, paragraphs separated by blank lines. End with a single short line that invites a reader reply or shares what's on Francisco's mind tomorrow — NEVER 'subscribe', NEVER 'forward this'>\"
}

Style anchors:
- Open with a concrete moment, not a summary.
- One idea per piece. Resist the urge to cover everything.
- Specifics > generalities. Lanes (CA→TX), commodities (romaine), weights (44k lbs), times (2am dispatch).
- Voice is a friend texting another broker, not a marketer.";

#[tauri::command]
pub async fn generate_newsletter_draft(state: State<'_, AppState>) -> Result<Draft, String> {
    let api_key = crate::commands::keychain::get_raw_api_key()
        .ok_or("No Anthropic API key in Settings")?;
    let conn = state.conn()?;

    // Pull unused notes from the last 24h
    let cutoff = chrono::Utc::now().timestamp() - 86400;
    let mut rows = conn.query(
        "SELECT id, body FROM daily_notes
         WHERE used_in_issue_id IS NULL AND created_at >= ?1
         ORDER BY created_at ASC",
        libsql::params![cutoff],
    ).await.map_err(|e| e.to_string())?;

    let mut notes = Vec::new();
    let mut note_ids = Vec::new();
    while let Some(r) = rows.next().await.map_err(|e| e.to_string())? {
        note_ids.push(r.get::<i64>(0).map_err(|e| e.to_string())?);
        notes.push(r.get::<String>(1).map_err(|e| e.to_string())?);
    }
    if notes.is_empty() {
        return Err("No unused notes in the last 24 hours. Add a note first.".into());
    }

    let user_message = format!(
        "Today's notes:\n\n{}",
        notes.iter().enumerate()
            .map(|(i, n)| format!("{}. {}", i+1, n))
            .collect::<Vec<_>>()
            .join("\n")
    );

    let body = json!({
        "model": SONNET,
        "max_tokens": 1500,
        "system": [{
            "type": "text",
            "text": NEWSLETTER_SYSTEM_PROMPT,
            "cache_control": { "type": "ephemeral" }
        }],
        "messages": [{ "role": "user", "content": user_message }]
    });

    let client = reqwest::Client::new();
    let resp = client.post(API_URL)
        .header("x-api-key", &api_key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send().await.map_err(|e| e.to_string())?;
    let raw = resp.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    let text = v["content"].as_array()
        .and_then(|arr| arr.iter().find(|b| b["type"] == "text"))
        .and_then(|b| b["text"].as_str())
        .ok_or_else(|| format!("No text in Claude response: {}", raw))?;

    // Strip code fences defensively
    let cleaned = text.trim()
        .strip_prefix("```json").or_else(|| text.trim().strip_prefix("```")).unwrap_or(text.trim())
        .strip_suffix("```").unwrap_or(text.trim())
        .trim();

    #[derive(Deserialize)]
    struct DraftOut { subject: String, body: String }
    let parsed: DraftOut = serde_json::from_str(cleaned)
        .map_err(|e| format!("Claude returned non-JSON: {} | raw: {}", e, text))?;

    // Persist
    let now = chrono::Utc::now().timestamp();
    let source_ids_json = serde_json::to_string(&note_ids).unwrap();
    conn.execute(
        "INSERT INTO newsletter_drafts (subject, body, source_note_ids, created_at) VALUES (?1, ?2, ?3, ?4)",
        libsql::params![parsed.subject.clone(), parsed.body.clone(), source_ids_json, now],
    ).await.map_err(|e| e.to_string())?;
    let id = last_insert_rowid(&conn).await?;

    Ok(Draft {
        id, subject: parsed.subject, body: parsed.body,
        source_note_ids: note_ids, created_at: now,
    })
}

#[tauri::command]
pub async fn update_draft(
    state: State<'_, AppState>,
    id: i64,
    subject: String,
    body: String,
) -> Result<(), String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE newsletter_drafts SET subject=?1, body=?2, updated_at=?3 WHERE id=?4",
        libsql::params![subject, body, now, id],
    ).await.map_err(|e| e.to_string())?;
    Ok(())
}
```

Register in lib.rs.

---

### Step 7: Subscriber management commands

**File to add to:** `src-tauri/src/commands/newsletter.rs`

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct Subscriber {
    pub id: i64,
    pub email: String,
    pub full_name: Option<String>,
    pub company: Option<String>,
    pub status: String,
    pub source: Option<String>,
    pub subscribed_at: i64,
    pub last_sent_at: Option<i64>,
}

#[tauri::command]
pub async fn add_subscriber(
    state: State<'_, AppState>,
    email: String,
    full_name: Option<String>,
    company: Option<String>,
) -> Result<Subscriber, String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();
    let token = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO subscribers (email, full_name, company, source, unsubscribe_token, subscribed_at)
         VALUES (?1, ?2, ?3, 'manual', ?4, ?5)
         ON CONFLICT(email) DO UPDATE SET status='active', unsubscribed_at=NULL",
        libsql::params![email.clone(), full_name, company, token, now],
    ).await.map_err(|e| e.to_string())?;
    let id = last_insert_rowid(&conn).await?;
    fetch_subscriber(&conn, id).await
}

#[tauri::command]
pub async fn get_subscribers(
    state: State<'_, AppState>,
    only_active: Option<bool>,
) -> Result<Vec<Subscriber>, String> {
    let conn = state.conn()?;
    let sql = if only_active.unwrap_or(true) {
        "SELECT id, email, full_name, company, status, source, subscribed_at, last_sent_at
         FROM subscribers WHERE status='active' ORDER BY subscribed_at DESC"
    } else {
        "SELECT id, email, full_name, company, status, source, subscribed_at, last_sent_at
         FROM subscribers ORDER BY subscribed_at DESC"
    };
    let mut rows = conn.query(sql, ()).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(r) = rows.next().await.map_err(|e| e.to_string())? {
        out.push(Subscriber {
            id: r.get::<i64>(0).map_err(|e| e.to_string())?,
            email: r.get::<String>(1).map_err(|e| e.to_string())?,
            full_name: r.get::<Option<String>>(2).ok().flatten(),
            company: r.get::<Option<String>>(3).ok().flatten(),
            status: r.get::<String>(4).map_err(|e| e.to_string())?,
            source: r.get::<Option<String>>(5).ok().flatten(),
            subscribed_at: r.get::<i64>(6).map_err(|e| e.to_string())?,
            last_sent_at: r.get::<Option<i64>>(7).ok().flatten(),
        });
    }
    Ok(out)
}

async fn fetch_subscriber(conn: &libsql::Connection, id: i64) -> Result<Subscriber, String> {
    let subs = get_subscribers_inner(conn, false).await?;
    subs.into_iter().find(|s| s.id == id).ok_or_else(|| "Not found".into())
}

async fn get_subscribers_inner(conn: &libsql::Connection, only_active: bool) -> Result<Vec<Subscriber>, String> {
    // (factor get_subscribers' query out for reuse)
    todo!("dedupe — share query body with get_subscribers")
}
```

(Replace the `todo!` by factoring the query out.)

For `unsubscribe` — write a simple Tauri command that sets status='unsubscribed'. The actual unsubscribe link in emails will point to a hosted endpoint later; for v1 either include a `mailto:` link or skip CAN-SPAM compliance until you actually go public.

---

### Step 8: Send via Resend

**File to add to:** `src-tauri/src/commands/newsletter.rs`

```rust
#[tauri::command]
pub async fn send_newsletter(
    state: State<'_, AppState>,
    draft_id: i64,
) -> Result<i64, String> {
    let conn = state.conn()?;
    let (cfg_api_key, from_email, from_name) = {
        let cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
        (cfg.resend_api_key.clone(), cfg.newsletter_from_email.clone(), cfg.newsletter_from_name.clone())
    };
    if cfg_api_key.is_empty() {
        return Err("Resend API key not configured in Settings".into());
    }
    if from_email.is_empty() {
        return Err("From email not configured in Settings".into());
    }

    // Load draft
    let mut rows = conn.query(
        "SELECT subject, body, source_note_ids FROM newsletter_drafts WHERE id = ?1",
        libsql::params![draft_id],
    ).await.map_err(|e| e.to_string())?;
    let r = rows.next().await.map_err(|e| e.to_string())?.ok_or("Draft not found")?;
    let subject: String = r.get::<String>(0).map_err(|e| e.to_string())?;
    let body: String = r.get::<String>(1).map_err(|e| e.to_string())?;
    let source_ids_json: String = r.get::<String>(2).map_err(|e| e.to_string())?;

    // Load active subscribers
    let mut sub_rows = conn.query(
        "SELECT id, email FROM subscribers WHERE status='active'",
        (),
    ).await.map_err(|e| e.to_string())?;
    let mut recipients: Vec<(i64, String)> = Vec::new();
    while let Some(sr) = sub_rows.next().await.map_err(|e| e.to_string())? {
        recipients.push((
            sr.get::<i64>(0).map_err(|e| e.to_string())?,
            sr.get::<String>(1).map_err(|e| e.to_string())?,
        ));
    }
    if recipients.is_empty() {
        return Err("No active subscribers to send to.".into());
    }

    // Resend batch API allows up to 100 per call
    let html = body_to_simple_html(&body);
    let client = reqwest::Client::new();
    let mut batch_id_out = String::new();

    for chunk in recipients.chunks(100) {
        let batch: Vec<serde_json::Value> = chunk.iter().map(|(_, email)| {
            serde_json::json!({
                "from": format!("{} <{}>", from_name, from_email),
                "to": [email],
                "subject": subject,
                "html": html,
                "text": body,
            })
        }).collect();

        let resp = client.post("https://api.resend.com/emails/batch")
            .bearer_auth(&cfg_api_key)
            .json(&batch)
            .send().await.map_err(|e| e.to_string())?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!("Resend error ({}): {}", status, text));
        }
        // First batch id only — sufficient for tracing
        if batch_id_out.is_empty() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(arr) = v["data"].as_array() {
                    if let Some(first) = arr.first() {
                        batch_id_out = first["id"].as_str().unwrap_or("").to_string();
                    }
                }
            }
        }
    }

    // Record issue + mark notes used
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO newsletter_issues (draft_id, subject, body, sent_at, recipient_count, resend_batch_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        libsql::params![draft_id, subject, body, now, recipients.len() as i64, batch_id_out],
    ).await.map_err(|e| e.to_string())?;
    let issue_id = last_insert_rowid(&conn).await?;

    // Bump subscribers.last_sent_at
    conn.execute(
        "UPDATE subscribers SET last_sent_at = ?1 WHERE status = 'active'",
        libsql::params![now],
    ).await.map_err(|e| e.to_string())?;

    // Mark draft as sent + flag the source notes
    conn.execute(
        "UPDATE newsletter_drafts SET sent_as_issue_id = ?1 WHERE id = ?2",
        libsql::params![issue_id, draft_id],
    ).await.map_err(|e| e.to_string())?;

    if let Ok(ids) = serde_json::from_str::<Vec<i64>>(&source_ids_json) {
        for nid in ids {
            let _ = conn.execute(
                "UPDATE daily_notes SET used_in_issue_id = ?1 WHERE id = ?2",
                libsql::params![issue_id, nid],
            ).await;
        }
    }

    Ok(issue_id)
}

fn body_to_simple_html(body: &str) -> String {
    let para = body
        .split("\n\n")
        .map(|p| format!("<p style='font: 16px/1.6 Inter,sans-serif; color: #1a1a1a; margin: 0 0 16px;'>{}</p>",
            html_escape(p)))
        .collect::<Vec<_>>()
        .join("");
    format!("<!doctype html><html><body style='margin:0;padding:24px;background:#f6f6f6;'>
        <div style='max-width:580px;margin:0 auto;background:#fff;padding:32px;border-radius:8px;'>{}</div>
    </body></html>", para)
}

fn html_escape(s: &str) -> String {
    s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
```

Register in lib.rs.

---

### Step 9: Newsletter view (the editor + send button)

**File to create:** `src/views/NewsletterView.tsx`

UI:
- Top toolbar: "Drafts ▼" picker, "Subscribers (N)" link, "+ New draft from today's notes" button
- Split editor: subject input on top, body textarea below (use a plain `<textarea>` — markdown rendering is overkill for plain text)
- Right panel: "Source notes" list (the daily_notes that fed this draft), each clickable to read full text
- Bottom action bar: "Save draft", "Preview" (toggles a Cmd-styled preview pane showing rendered HTML), "Send to N subscribers" (with confirmation modal)

When "Send" is clicked → modal: "About to send to {N} subscribers. Subject: {subject}. Continue?" → on yes, call `send_newsletter(draftId)`.

Add to sidebar (`Newsletter`, shortcut `⌘0` or rebind something) and router.

---

### Step 10: Subscribers view

Simple table inside the Newsletter view or its own tab:
- Add subscriber form (email, name, company)
- List with email / name / company / status / subscribed_at / last_sent_at
- CSV import (re-use the existing import infrastructure — register a new source_type='subscriber' that routes to `add_subscriber` instead of `create_contact`)
- Bulk unsubscribe button per row

---

### Step 11: Connection-test buttons

In SettingsView, next to Resend config, add a "Test send" button that fires `send_newsletter` to a test list of one (a temporary subscriber row marked source='test'). Helps catch DNS / SPF issues before going public.

---

## How to test the whole unit

1. Settings → Resend → paste your `re_...` key, set From email + From name. Save.
2. Settings → click "Test send". Get a small test email at your own inbox. If it doesn't arrive in 60 sec, check Resend dashboard for delivery logs.
3. Subscribers → add your own email + 2 colleagues' emails.
4. `⌘9` Notes → add 3 notes throughout the day. Examples:
    - "Sysco Houston bumped a load 2hrs from Salinas this morning, took it to JBS — first time working with them"
    - "Reefer market in CA tight this week, spot rates up 12% vs last Mon"
    - "Got ghosted by 3 leads I called Tuesday — pattern: all multi-DC retailers, single-buyer model"
5. `⌘0` Newsletter → click "+ New draft from today's notes". Draft appears in ~5s. Subject + body filled.
6. Read it. Edit anything that doesn't sound like you. Save.
7. Click Preview → renders as it'll arrive (white background, single-column).
8. Click "Send to 3 subscribers" → confirmation → Send. Toast: "Sent to 3."
9. Within 60s, check your inbox + the colleagues you added. Email arrives, looks right.
10. Newsletter view → "Issues" tab shows the sent issue with recipient count.
11. `⌘9` Notes → the 3 notes used are gone from the "unused" list. (They're flagged `used_in_issue_id` — still in DB, just hidden.)

If all 11 steps work, Unit 5 is done.

---

## What to tell Claude Code to build this for me

```text
Execute build_manual/05_newsletter.md from start to finish. Units 1-4 must already be merged.

Constraints:
- Stack is fixed: Tauri 2 + React 19 + Turso/libSQL + Resend + Anthropic.
- All schema in src-tauri/src/db.rs apply_v7.
- Resend integration: use the HTTP API (https://api.resend.com/emails/batch) — do NOT add a Resend SDK.
- The newsletter system prompt in Step 6 stays verbatim — it captures Francisco's voice rules.
- Use SONNET (claude-sonnet-4-6) for draft generation per the constant in src-tauri/src/claude.rs.
- In Step 7 fix the todo!() by factoring the get_subscribers query into a shared helper, do not leave it as todo!().
- Step 11 test send: insert a test subscriber row with source='test', send, then DELETE that row. Don't pollute the subscribers table.
- Use TodoWrite to mark each step.
- Run the 11-step walkthrough. Report passes/fails. Stop before Unit 6.
```

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Test send fails with "Domain not verified" | Resend requires DNS verification of the sending domain | Add SPF + DKIM CNAMEs per Resend dashboard. Wait 5–15 min for DNS propagation. |
| Draft generator fails: "No unused notes in the last 24 hours" | Notes are older or already used | Add a fresh note via `⌘9` and retry. |
| Draft is too long / wrong voice | Prompt drift from Claude | The system prompt has hard limits ("280-340 words"). If still drifting, lower max_tokens to 800 to clip. |
| Send succeeds but subscribers don't receive | DNS/SPF issue or Resend free-tier rate limit | Resend dashboard → Logs. Check for 'bounced' or 'delivered'. Free tier = 100/day; the message in step 8 errors clearly if Resend returns 429. |
| Notes never re-appear after sending | `used_in_issue_id` correctly hides them. Intended. | If you want to repurpose a note in a later issue, manually clear it: `UPDATE daily_notes SET used_in_issue_id = NULL WHERE id = ?`. |
| `add_subscriber` errors with duplicate email | UNIQUE constraint on email | The INSERT uses `ON CONFLICT(email) DO UPDATE SET status='active'` — that's correct behavior, no fix needed. |
| Sent HTML looks broken in Gmail | Inline-style only; no `<head>` `<style>` | The `body_to_simple_html` function uses inline styles already. If Gmail still mangles, test in Litmus and tighten. |
| Resend batch returns 200 but no email arrives | Resend in test mode (sending to non-verified addresses) | In Resend dashboard, ensure you're on production mode — test mode only delivers to your own account email. |
