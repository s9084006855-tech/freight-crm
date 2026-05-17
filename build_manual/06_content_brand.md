# Unit 6 — Content Brand

## What you're building

A "Repurpose" page where you paste (or pick from your sent newsletter issues) a piece of writing and Claude returns three platform variants: a LinkedIn post (300–500 chars, hook + 3-line story + soft CTA), an X post (under 280 chars, single insight), and a short-video script (45 seconds, hook + body + payoff, written for camera). Each variant lives in a `social_posts` table so you can edit, copy, and track which ones you actually published.

This unit is intentionally lighter than the others. Three Claude calls, one DB table, one page. No scheduling, no auto-publishing — you copy/paste into LinkedIn/X manually. That stays out of API throttling drama until you're sure the formats are working.

---

## Prerequisites

- [x] Unit 5 complete (so you have sent newsletter issues to source from)
- [x] Anthropic API key saved
- [x] On a branch: `git checkout -b feature/unit-6-content-brand`

---

## Step-by-step build

### Step 1: `social_posts` table (v8 migration)

**File to modify:** `src-tauri/src/db.rs`

```rust
async fn apply_v8(conn: &libsql::Connection) -> Result<(), libsql::Error> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS social_posts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            platform        TEXT NOT NULL,
                -- 'linkedin' | 'x' | 'short_video' | 'thread' | 'other'
            source_text     TEXT NOT NULL,
                -- the original input that was repurposed
            source_issue_id INTEGER REFERENCES newsletter_issues(id) ON DELETE SET NULL,
            body            TEXT NOT NULL,
            -- Optional CTA / hook variants the model also produced
            hook            TEXT,
            cta             TEXT,
            -- Lifecycle
            status          TEXT NOT NULL DEFAULT 'draft',
                -- draft | scheduled | published | archived
            published_at    INTEGER,
            published_url   TEXT,
            char_count      INTEGER GENERATED ALWAYS AS (length(body)) VIRTUAL,
            created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_sp_platform ON social_posts(platform, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sp_status   ON social_posts(status);
        CREATE INDEX IF NOT EXISTS idx_sp_source   ON social_posts(source_issue_id);
    ").await?;
    Ok(())
}
```

Wire in `init_schema_async`.

**Verify:** Table exists. Insert a fake row, observe `char_count` is populated automatically.

---

### Step 2: Repurpose command (one Claude call → three variants)

**File to create:** `src-tauri/src/commands/repurpose.rs`

```rust
use crate::AppState;
use crate::claude::{API_URL, API_VERSION, SONNET};
use crate::db::last_insert_rowid;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SocialPost {
    pub id: i64,
    pub platform: String,
    pub source_text: String,
    pub source_issue_id: Option<i64>,
    pub body: String,
    pub hook: Option<String>,
    pub cta: Option<String>,
    pub status: String,
    pub published_at: Option<i64>,
    pub published_url: Option<String>,
    pub char_count: Option<i64>,
    pub created_at: i64,
}

const REPURPOSE_SYSTEM_PROMPT: &str = "You repurpose a single piece of writing (from Francisco Pelaez, a one-person produce freight broker, voice: direct, on-the-ground, no buzzwords, no exclamation points) into THREE platform-native variants.

OUTPUT: strict JSON only.
{
  \"linkedin\": {
    \"hook\": \"<first line — the scroll-stop, 8-14 words>\",
    \"body\": \"<full post 300-500 chars, line breaks between paragraphs, ends with a one-line insight not a question>\"
  },
  \"x\": {
    \"body\": \"<single tweet under 280 chars, one specific insight, no hashtags, no thread>\"
  },
  \"short_video\": {
    \"hook\": \"<10 words max, said in the first 2 seconds on camera>\",
    \"body\": \"<45-second script, plain text, no stage directions. Spoken word — short sentences. Ends with a payoff line.>\"
  }
}

Voice rules (apply to all three):
- Specifics > generalities. Lanes (CA→TX), commodities (romaine), weights (44k), times (2am).
- One idea per piece. Do not summarize the source — pull the most interesting concrete moment.
- No 'just', no 'really', no 'super', no 'literally', no exclamation points, no emojis.
- LinkedIn audience: shippers, brokers, dispatchers, logistics execs. X audience: same plus owner-operators and freight Twitter. Short-video audience: same plus broader trucking community.
- Sound like a friend texting another broker, not a marketer.";

#[derive(Deserialize)]
struct ModelOut {
    linkedin: LinkedInOut,
    x: XOut,
    short_video: VideoOut,
}
#[derive(Deserialize)]
struct LinkedInOut { hook: String, body: String }
#[derive(Deserialize)]
struct XOut { body: String }
#[derive(Deserialize)]
struct VideoOut { hook: String, body: String }

#[tauri::command]
pub async fn repurpose_content(
    state: State<'_, AppState>,
    source_text: String,
    source_issue_id: Option<i64>,
) -> Result<Vec<SocialPost>, String> {
    let api_key = crate::commands::keychain::get_raw_api_key()
        .ok_or("No Anthropic API key in Settings")?;
    let conn = state.conn()?;

    let body = json!({
        "model": SONNET,
        "max_tokens": 1500,
        "system": [{
            "type": "text",
            "text": REPURPOSE_SYSTEM_PROMPT,
            "cache_control": { "type": "ephemeral" }
        }],
        "messages": [{
            "role": "user",
            "content": format!("Source text:\n\n{}", source_text)
        }]
    });

    let client = reqwest::Client::new();
    let resp = client.post(API_URL)
        .header("x-api-key", &api_key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .json(&body).send().await.map_err(|e| e.to_string())?;
    let raw = resp.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    let text = v["content"].as_array()
        .and_then(|arr| arr.iter().find(|b| b["type"] == "text"))
        .and_then(|b| b["text"].as_str())
        .ok_or_else(|| format!("No text in Claude response: {}", raw))?;
    let cleaned = text.trim()
        .strip_prefix("```json").or_else(|| text.trim().strip_prefix("```")).unwrap_or(text.trim())
        .strip_suffix("```").unwrap_or(text.trim()).trim();
    let parsed: ModelOut = serde_json::from_str(cleaned)
        .map_err(|e| format!("Non-JSON output: {} | raw: {}", e, text))?;

    let now = chrono::Utc::now().timestamp();
    let mut out = Vec::new();

    for (platform, body_text, hook, cta) in [
        ("linkedin",    parsed.linkedin.body.clone(),    Some(parsed.linkedin.hook.clone()),    None::<String>),
        ("x",           parsed.x.body.clone(),           None,                                  None),
        ("short_video", parsed.short_video.body.clone(), Some(parsed.short_video.hook.clone()), None),
    ] {
        conn.execute(
            "INSERT INTO social_posts (platform, source_text, source_issue_id, body, hook, cta, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7)",
            libsql::params![platform, source_text.clone(), source_issue_id, body_text.clone(), hook.clone(), cta.clone(), now],
        ).await.map_err(|e| e.to_string())?;
        let id = last_insert_rowid(&conn).await?;
        out.push(SocialPost {
            id,
            platform: platform.into(),
            source_text: source_text.clone(),
            source_issue_id,
            body: body_text,
            hook,
            cta,
            status: "draft".into(),
            published_at: None,
            published_url: None,
            char_count: None, // virtual column — frontend recomputes
            created_at: now,
        });
    }

    Ok(out)
}

#[tauri::command]
pub async fn get_social_posts(
    state: State<'_, AppState>,
    platform: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<SocialPost>, String> {
    let conn = state.conn()?;
    let mut sql = String::from(
        "SELECT id, platform, source_text, source_issue_id, body, hook, cta, status,
                published_at, published_url, char_count, created_at
         FROM social_posts WHERE 1=1"
    );
    let mut params: Vec<libsql::Value> = vec![];
    if let Some(p) = platform { sql.push_str(" AND platform = ?"); params.push(libsql::Value::Text(p)); }
    if let Some(s) = status   { sql.push_str(" AND status = ?");   params.push(libsql::Value::Text(s)); }
    sql.push_str(" ORDER BY created_at DESC LIMIT ?");
    params.push(libsql::Value::Integer(limit.unwrap_or(50)));

    let mut rows = conn.query(&sql, params).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(r) = rows.next().await.map_err(|e| e.to_string())? {
        out.push(SocialPost {
            id: r.get::<i64>(0).map_err(|e| e.to_string())?,
            platform: r.get::<String>(1).map_err(|e| e.to_string())?,
            source_text: r.get::<String>(2).map_err(|e| e.to_string())?,
            source_issue_id: r.get::<Option<i64>>(3).ok().flatten(),
            body: r.get::<String>(4).map_err(|e| e.to_string())?,
            hook: r.get::<Option<String>>(5).ok().flatten(),
            cta: r.get::<Option<String>>(6).ok().flatten(),
            status: r.get::<String>(7).map_err(|e| e.to_string())?,
            published_at: r.get::<Option<i64>>(8).ok().flatten(),
            published_url: r.get::<Option<String>>(9).ok().flatten(),
            char_count: r.get::<Option<i64>>(10).ok().flatten(),
            created_at: r.get::<i64>(11).map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn update_social_post(
    state: State<'_, AppState>,
    id: i64,
    body: Option<String>,
    status: Option<String>,
    published_url: Option<String>,
) -> Result<(), String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().timestamp();
    if let Some(b) = body {
        conn.execute("UPDATE social_posts SET body=?1, updated_at=?2 WHERE id=?3",
            libsql::params![b, now, id]).await.map_err(|e| e.to_string())?;
    }
    if let Some(s) = status {
        let publish_ts = if s == "published" { Some(now) } else { None };
        conn.execute("UPDATE social_posts SET status=?1, published_at=COALESCE(?2, published_at), updated_at=?3 WHERE id=?4",
            libsql::params![s, publish_ts, now, id]).await.map_err(|e| e.to_string())?;
    }
    if let Some(u) = published_url {
        conn.execute("UPDATE social_posts SET published_url=?1, updated_at=?2 WHERE id=?3",
            libsql::params![u, now, id]).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

Register in lib.rs.

---

### Step 3: TypeScript types + db.ts wrappers

**File to modify:** `src/types/index.ts`

```typescript
export type SocialPlatform = "linkedin" | "x" | "short_video" | "thread" | "other";
export type SocialPostStatus = "draft" | "scheduled" | "published" | "archived";

export interface SocialPost {
  id: number;
  platform: SocialPlatform;
  source_text: string;
  source_issue_id?: number;
  body: string;
  hook?: string;
  cta?: string;
  status: SocialPostStatus;
  published_at?: number;
  published_url?: string;
  char_count?: number;
  created_at: number;
}
```

**File to modify:** `src/lib/db.ts`

```typescript
export const repurposeContent = (sourceText: string, sourceIssueId?: number) =>
  invoke<SocialPost[]>("repurpose_content", { sourceText, sourceIssueId });

export const getSocialPosts = (platform?: SocialPlatform, status?: SocialPostStatus, limit?: number) =>
  invoke<SocialPost[]>("get_social_posts", { platform, status, limit });

export const updateSocialPost = (id: number, patch: { body?: string; status?: SocialPostStatus; published_url?: string }) =>
  invoke<void>("update_social_post", { id, ...patch });
```

---

### Step 4: Repurpose view

**File to create:** `src/views/RepurposeView.tsx`

```tsx
import { useState, useEffect } from "react";
import * as db from "../lib/db";
import type { SocialPost, SocialPlatform, SocialPostStatus } from "../types";
import { useToast } from "../hooks/useToast";
import { humanError } from "../lib/errors";

const LIMITS: Record<SocialPlatform, number> = {
  linkedin: 3000,
  x: 280,
  short_video: 1200,
  thread: 0,
  other: 0,
};

function CharBadge({ post }: { post: SocialPost }) {
  const limit = LIMITS[post.platform];
  if (!limit) return null;
  const count = post.body.length;
  const over = count > limit;
  return (
    <span className={`text-xs font-mono ${over ? "text-red-400" : count > limit * 0.9 ? "text-yellow-400" : "text-zinc-500"}`}>
      {count}/{limit}
    </span>
  );
}

export function RepurposeView() {
  const [sourceText, setSourceText] = useState("");
  const [working, setWorking] = useState(false);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [filter, setFilter] = useState<SocialPlatform | "all">("all");
  const [statusFilter, setStatusFilter] = useState<SocialPostStatus | "all">("draft");
  const toast = useToast();

  const reload = async () => {
    const p = await db.getSocialPosts(
      filter === "all" ? undefined : filter,
      statusFilter === "all" ? undefined : statusFilter,
    );
    setPosts(p);
  };
  useEffect(() => { reload().catch((e) => toast.error(humanError(e))); }, [filter, statusFilter]);

  const repurpose = async () => {
    if (!sourceText.trim()) { toast.error("Paste some source text first."); return; }
    setWorking(true);
    try {
      await db.repurposeContent(sourceText.trim());
      setSourceText("");
      await reload();
      toast.success("Generated 3 variants");
    } catch (e) { toast.error(humanError(e)); }
    finally { setWorking(false); }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-zinc-800 shrink-0">
        <h2 className="text-sm font-semibold text-zinc-100">Repurpose to social</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Paste a newsletter issue, a story from your day, or any source text. Claude returns LinkedIn / X / short-video variants in your voice.
        </p>
      </div>

      <div className="px-6 py-4 border-b border-zinc-800 shrink-0">
        <textarea value={sourceText} onChange={(e) => setSourceText(e.target.value)}
          placeholder="Paste source text…"
          rows={4}
          className="w-full px-3 py-2 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 resize-none" />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-zinc-600 font-mono">{sourceText.length} chars · ~$0.005 per repurpose</span>
          <button onClick={repurpose} disabled={working || !sourceText.trim()}
            className="px-4 py-1.5 text-xs font-mono bg-indigo-700 hover:bg-indigo-600 text-white rounded disabled:opacity-50">
            {working ? "Generating…" : "Repurpose →"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 px-6 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex gap-1">
          {(["all", "linkedin", "x", "short_video"] as const).map((p) => (
            <button key={p} onClick={() => setFilter(p)}
              className={`px-2.5 py-1 text-xs font-mono rounded ${filter === p ? "text-zinc-100 bg-zinc-700" : "text-zinc-500 hover:text-zinc-300"}`}>
              {p}
            </button>
          ))}
        </div>
        <span className="text-zinc-700">·</span>
        <div className="flex gap-1">
          {(["draft", "published", "archived", "all"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 text-xs font-mono rounded ${statusFilter === s ? "text-zinc-100 bg-zinc-700" : "text-zinc-500 hover:text-zinc-300"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {posts.length === 0 && (
          <p className="text-xs text-zinc-600 font-mono text-center py-12">No posts yet. Paste source above.</p>
        )}
        {posts.map((p) => (
          <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                {p.platform.replace("_", " ")}
              </span>
              <div className="flex items-center gap-3">
                <CharBadge post={p} />
                <span className={`text-xs px-2 py-0.5 rounded ${p.status === "published" ? "bg-green-900/40 text-green-300" : "bg-zinc-800 text-zinc-400"}`}>
                  {p.status}
                </span>
              </div>
            </div>
            {p.hook && <p className="text-xs text-indigo-300 italic mb-1.5">{p.hook}</p>}
            <textarea value={p.body}
              onChange={(e) => {
                setPosts((ps) => ps.map((x) => x.id === p.id ? { ...x, body: e.target.value } : x));
              }}
              onBlur={() => db.updateSocialPost(p.id, { body: p.body })}
              rows={p.platform === "x" ? 3 : 6}
              className="w-full text-sm text-zinc-200 bg-transparent border-none outline-none resize-none font-mono" />
            <div className="flex items-center gap-2 mt-3">
              <button onClick={() => { navigator.clipboard.writeText(p.body); toast.success("Copied"); }}
                className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded">
                Copy
              </button>
              {p.status === "draft" && (
                <button onClick={async () => {
                  await db.updateSocialPost(p.id, { status: "published" });
                  await reload();
                }}
                  className="text-xs px-2.5 py-1 bg-green-900/40 hover:bg-green-900/60 text-green-300 rounded">
                  Mark as published
                </button>
              )}
              <button onClick={async () => {
                await db.updateSocialPost(p.id, { status: "archived" });
                await reload();
              }}
                className="text-xs px-2.5 py-1 text-zinc-500 hover:text-zinc-300">
                Archive
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Add to sidebar (label `Repurpose`, shortcut: rebind one of the lower-priority slots, or use `⌘\``).

**Verify:** `npm run build` passes.

---

### Step 5: "Repurpose this issue" button on Newsletter view

**File to modify:** `src/views/NewsletterView.tsx`

On each sent issue row, add a button: "Repurpose →" that calls `repurposeContent(issue.body, issue.id)` and then navigates to RepurposeView.

```tsx
const setView = useUIStore((s) => s.setView);
// ...
<button onClick={async () => {
  await db.repurposeContent(issue.body, issue.id);
  setView("repurpose");
  toast.success("Generated variants — see Repurpose view");
}}
  className="text-xs px-2.5 py-1 bg-indigo-700 hover:bg-indigo-600 text-white rounded">
  Repurpose →
</button>
```

---

## How to test the whole unit

1. Open Repurpose view. Empty list, paste box ready.
2. Paste a sent newsletter issue body into the box. Click **Repurpose →**.
3. Within ~6s, three variants appear: linkedin, x, short_video.
4. The X variant shows char count badge (e.g. `247/280` green or `295/280` red).
5. The LinkedIn variant has a hook line above the body in italics.
6. Edit the LinkedIn body inline. Tab out of the textarea — change persists (auto-save on blur).
7. Click Copy on the X variant. Paste into the X compose box on x.com — it fits the limit, sounds like you.
8. Click **Mark as published** on the LinkedIn variant. Status badge flips to green.
9. Filter chip "published" — only the LinkedIn variant shows.
10. Go to Newsletter view → past issues → click **Repurpose →** on an issue. It creates 3 fresh variants from that issue body, navigates back to Repurpose view with them on top.
11. Verify `social_posts.source_issue_id` is set on the issue-sourced variants (DB shell or hover in UI for v2).

If all 11 steps work, Unit 6 is done.

---

## What to tell Claude Code to build this for me

```text
Execute build_manual/06_content_brand.md from start to finish. Units 1-5 must already be merged.

Constraints:
- Stack is fixed: Tauri 2 + React 19 + Turso/libSQL + Anthropic.
- Schema in src-tauri/src/db.rs apply_v8.
- Use SONNET (claude-sonnet-4-6) via the constant in src-tauri/src/claude.rs.
- The REPURPOSE_SYSTEM_PROMPT in Step 2 stays verbatim.
- char_count is a VIRTUAL generated column — do not compute in app code.
- Auto-save on blur for inline edits (no Save button needed).
- Use TodoWrite to mark each step.
- Run the 11-step walkthrough. Report passes/fails. Stop before Unit 7.
```

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| All 3 variants look like the source paraphrased | Claude isn't pulling a specific moment | Add to the system prompt: "Do NOT summarize the source. Pick the single most specific moment and build around that." |
| LinkedIn variant has emoji / exclamation | Voice rules drifted | Re-tighten the prompt's voice rules. Re-run. |
| X variant over 280 chars | Limit not enforced | The CharBadge shows red but doesn't auto-truncate. Edit it down manually or re-prompt with "X variant MUST be under 280 chars — count strictly." |
| short_video script is too long for 45s | Pace varies; ~150 words per 60s is typical | Tighten to "30-second script, 80-120 words". |
| Edit-and-blur doesn't save | `onBlur` fires before state batch, sends stale `p.body` | Use the latest state via a ref or refetch after blur. The current code reads from the `posts` array which has the latest edit — should work. If it doesn't, switch to a controlled component pattern with an explicit Save button per row. |
| Repurpose-this-issue button creates 3 variants but doesn't navigate | `setView("repurpose")` requires "repurpose" to be in the ViewName union | Add it to `src/types/index.ts`. |
