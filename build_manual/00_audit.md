# Codebase Audit — what already exists, what's stubbed, what conflicts with the plan

**Audited:** 2026-05-17
**Auditor:** Claude (Opus 4.6)
**Goal:** Surface anything in the existing code that makes a step in this manual wrong or wasted before writing the unit files.

---

## Stack as-is

| Layer | Choice | Notes |
|---|---|---|
| Desktop shell | Tauri 2.x | Cross-platform (Mac/Windows verified) |
| Frontend | React 19 + TypeScript + Tailwind v4 + Zustand + Framer Motion | |
| Database | **Turso (libSQL cloud)** | Migrated in v0.5.0 from local SQLite. `rusqlite` kept ONLY for one-time migration from old Mac SQLite files |
| Sync | Turso cloud (no more iCloud / lockfiles) | All devices read/write same remote DB |
| Credential store | `keyring` v3 with `apple-native` / `windows-native` features | Fixed in this session — was previously broken on Windows |
| OCR (Mac) | Apple Vision via Swift helper + bundled Tesseract | Mac-only paths |
| OCR (cross-platform) | **Claude Vision (Sonnet 4.6)** | Built in this session — `ocr_image_claude` and `ocr_pdf_claude` commands with prompt caching |
| LLM | Anthropic API direct via `reqwest` (rustls-tls) | Used for OCR and Enrichment |

---

## Database schema (v2, currently on Turso)

```
contacts             (full address book — 24 cols incl. enrichment_status/data/at)
contact_people       (named individuals per company)
activities           (call/note/email/follow_up — includes user_id from v2)
tags / contact_tags  (untyped tagging, unused in UI)
import_sessions      (every CSV/XLSX/PDF/image import gets a row)
import_session_contacts (per-contact rollback ledger with previous_data JSON)
column_mapping_templates (saved column→field maps per source format)
parsing_logs         (per-row import audit)
sync_metadata        (legacy, used to be for iCloud last-write-wins)
error_log            (frontend error funnel)
app_settings         (k/v store for UI prefs — sync_path, claude_auto_enhance, mc_number, etc.)
schema_migrations    (version tracker)
```

**Schema migrations live in:** `src-tauri/src/db.rs` (`init_schema_async` runs on every Turso connect).

**Missing tables relevant to this build manual** (will be added per unit):
- `loads` — load tracker (BROKERAGE CORE)
- `load_legs` — multi-stop loads (BROKERAGE CORE, optional)
- `pipeline_stages` — configurable pipeline column definitions (CRM)
- `pipeline_cards` — shippers in pipeline with current stage (CRM)
- `rate_con_templates` — per-shipper rate confirmation templates (CRM)
- `rate_cons` — generated rate confirmations (CRM)
- `lead_queue` — outbound prospects sorted by score (LEAD GEN)
- `lead_scores` — append-only score history for tuning (LEAD GEN)
- `lead_sources` — registered discovery sources (LEAD GEN)
- `subagent_runs` — observability for agent loops (LEAD GEN)
- `newsletter_drafts` — Claude-generated drafts (NEWSLETTER)
- `newsletter_issues` — sent issues (NEWSLETTER)
- `subscribers` — newsletter audience (NEWSLETTER)
- `social_posts` — repurposed content variants (CONTENT BRAND)
- `daily_notes` — Francisco's "running note throughout the day" that feeds newsletter + content (NEWSLETTER / CONTENT)

---

## Rust commands already wired (`src-tauri/src/commands/`)

| File | Commands | Status |
|---|---|---|
| `contacts.rs` | `get_contacts`, `get_contact`, `create_contact`, `update_contact`, `delete_contact`, `search_contacts` | Solid |
| `activities.rs` | `log_activity`, `get_activities`, `get_follow_ups`, `mark_follow_up_done`, `get_dashboard_stats` | Solid. `get_follow_ups` is the foundation for the Customer Success "needs follow-up" view |
| `import.rs` | `create_import_session`, `commit_import`, `rollback_import`, `get_import_sessions`, `get_mapping_templates`, `save_mapping_template`, `delete_mapping_template`, `find_matching_template` | Solid. Single transaction + per-row snapshot rollback. **Re-use this for lead_queue → contacts promotion.** |
| `keychain.rs` | `store_api_key`, `get_api_key_masked`, `has_api_key`, `delete_api_key`, `get_raw_api_key` (internal) | Fixed in this session — works on Windows now |
| `ocr.rs` | `ocr_image`, `ocr_image_claude`, `ocr_pdf_claude`, `test_ocr_engines` | Built this session |
| `sync.rs` | `get_sync_status` | Returns green/red based on Turso connection |
| `diagnostics.rs` | `get_error_log`, `log_error`, `export_backup`, `get_app_info` | Solid |
| `settings.rs` | `get_settings`, `update_setting`, `connect_turso`, `migrate_local_to_turso` | Solid. `connect_turso` writes creds to `local_config.json` + auto-reconnect on startup |
| `startup.rs` | `run_startup_check` | Checks Turso creds + connection + schema + OCR availability |
| `users.rs` | `get_users`, `get_active_user`, `set_active_user` | Two hardcoded profiles: Francisco + Jack |
| `enrich.rs` | `enrich_contact`, `enrich_all_contacts` | **Calls Claude Haiku 4.5 with `web_search_20250305` tool to research shippers.** Writes profile JSON to `contacts.enrichment_data`. This IS a working subagent already — the lead gen "scoring agent" can build on this pattern. |

---

## Frontend already wired (`src/`)

```
App.tsx                           router + login + global keyboard
components/
  common/         ErrorBoundary, Toast, Modal, SyncDot, StartupCheck (with inline Turso config form),
                  LoginScreen (2 hardcoded profiles), UpdateChecker
  layout/         AppShell (orbs + grid bg), Sidebar, StatusBar, CommandPalette (⌘K)
  contacts/       ContactList (virtualizable-ready), ContactRow, ContactDetail, ContactForm, ContactFilters
  activities/     QuickCallModal (⌘L), ActivityFeed
  dashboard/      StatsRow, FollowUpQueue, USHeatmap
  import/         ImportHub (5 tabs: File / PDF / Paste / Image / Quick add / Enrich),
                  DropZone, ColumnMapper, ImportReview, MergeDialog, ImportHistory,
                  PasteParser, ImageOCR, PdfOcr, QuickAddForm, EnrichmentPanel
  diagnostics/    DiagnosticsPanel (⌘⇧D)
views/            DashboardView, ContactsView, ContactDetailView, ImportView, SettingsView
features/
  strategy-map/   StrategyMap.tsx (the Disney 1957 map — scrollable, dark theme, inline deep-dives)
store/            contacts.ts, ui.ts, sync.ts (Zustand)
hooks/            useContacts, useActivities, useSync, useKeyboard, useToast
lib/
  db.ts              all invoke() wrappers
  phone.ts           normalize, format, match
  dedup.ts           Levenshtein, classifyRow (green/yellow/red)
  import-parse.ts    PapaParse + SheetJS
  paste-parse.ts     regex extraction for paste tab
  errors.ts          logError, humanError
types/index.ts       all TS interfaces
```

---

## What's already working that the manual can build on

1. **Activities + follow-ups infrastructure** is solid. The Customer Success "needs follow-up after N days" view is mostly a Rust query change + a new dashboard widget. Don't rebuild this.
2. **Import pipeline (session → review → commit → rollback)** is well-designed. Promoting a `lead_queue` row to a `contacts` row should reuse `create_import_session` + `commit_import` rather than reinvent.
3. **Enrichment subagent pattern** (`enrich.rs`) already shows how to call Claude with web search, parse JSON, persist to DB, and emit progress events to the frontend. The Discovery and Scoring agents in LEAD GEN follow this same shape.
4. **Claude API plumbing** is established: `get_raw_api_key()` from keychain + `reqwest` with rustls + prompt caching pattern (`cache_control: ephemeral`). Re-use for newsletter draft generator.
5. **PDF chunking pattern** in `ocr_pdf_claude` (iterate with offsets, prompt-cache the document, emit progress) is the template for any future bulk-Claude operation.
6. **Strategy Map** UI is already a nice scrollable card layout — use the same visual language for Customer Success and Lead Gen dashboards.

---

## What's stubbed / partial / dead

| Item | State | Action |
|---|---|---|
| `tags` / `contact_tags` tables | Schema exists, no UI | Either build tag UI in CRM unit or remove tables (keep — useful for `hot` / `warm` / `cold` per BUILD_PLAN.md) |
| `sync_metadata` table | Legacy from pre-Turso days | Leave it — harmless, can repurpose for Turso replication metrics later |
| `mc_number`, `dot_number`, `scac` in `app_settings` | Spec says these should be settable in Settings | Currently NOT in SettingsView UI — surface this in CRM unit so rate cons can render them |
| `USHeatmap.tsx` dashboard widget | Exists | Already loaded with `contacts_by_state` from `get_dashboard_stats` — works |
| `tauri-plugin-fs` / `tauri-plugin-dialog` | Enabled but barely used | Available for newsletter "export drafts" / Resend send confirmations — no extra setup needed |
| `vision_ocr` Swift helper | Mac-only path | Leave it. On Windows it gracefully falls through to Claude Vision (we added that in `startup.rs`) |

---

## What conflicts with the build manual plan

### Conflict 1: BUILD_PLAN.md says "No loads tracking / rate confirmations" (R5)

The original `docs/BUILD_PLAN.md` includes:

> R5: No loads tracking / rate confirmations
> This is a business acquisition CRM only. TMS system handles loads separately. No loads table, no rate confirmation docx generation.

**The new build manual reverses this.** The brokerage core unit (Unit 1) is explicitly a load tracker, and Unit 2 (CRM) includes rate confirmation generation. Francisco explicitly asked for both in the new task.

**Resolution:** Update `docs/BUILD_PLAN.md` to remove R5 when starting Unit 1. The new vision (per the Disney 1957 strategy map) treats the brokerage as the creative engine that everything else feeds; tracking loads is the cleanest way to capture stories, lanes, and shipper preferences that fuel the other units. Flag this in Unit 1 step 1.

### Conflict 2: Existing `enrich.rs` is `claude-haiku-4-5-20251001`, my OCR uses `claude-sonnet-4-6`

Two different models hardcoded in two places. Not a conflict, just inconsistency. Should extract into a single `const CLAUDE_MODELS` module so the build manual unit files can reference one source of truth. **Flag in Unit 4 step 1** (Lead Gen) — extract model constants there.

### Conflict 3: "Contact" terminology overloaded

`contacts` table is currently used for both shippers AND people we'd call. The build manual's Lead Gen unit needs to distinguish "lead" (prospect, never booked) from "shipper" (booked at least one load) from "person" (named individual within a company). Today only the last is tracked separately (`contact_people`).

**Resolution in Unit 1:** Add a `relationship_state` column to `contacts` (`prospect | active | dormant | declined`) so we can filter without renaming. Do NOT rename the `contacts` table.

### Conflict 4: `enrichment_data` column is a JSON blob

It stores the entire Claude research blob. Lead Gen scoring needs structured access to fields like `shipping_lanes`, `annual_volume_estimate`, etc. Options:
- (a) Add typed columns (`lanes_json`, `volume_band`, etc.) and migrate
- (b) Keep blob, write a Rust helper that pulls a few fields out via SQLite JSON functions

**Recommendation:** Option (b) for now — SQLite supports `json_extract()` and Turso passes that through. Less migration risk. Flag in Unit 4.

### Conflict 5: Profile system has 2 hardcoded users (Francisco + Jack)

This is fine for the personal-CRM phase but blocks the eventual SaaS multi-tenant migration. The SaaS unit (Unit 7, outline only) must call out that users need to move from hardcoded `all_users()` in `users.rs` to a `users` table with per-tenant scoping.

---

## What's missing that the manual will add (preview)

| Unit | Adds |
|---|---|
| 1. Brokerage core | `loads` table + load tracker UI in the format `[Consignee] — [Destination], 1) Order# / PO# / Weight / Pallets / Cases`, `relationship_state` column on contacts |
| 2. CRM | `pipeline_stages` (configurable), `pipeline_cards`, `rate_con_templates`, `rate_cons`, kanban pipeline view, rate con generator |
| 3. Customer Success | Configurable `follow_up_after_days` setting, "Stale shippers" dashboard widget, weekly check-in template generator |
| 4. Lead Gen Subagents | `lead_queue`, `lead_scores`, `lead_sources`, `subagent_runs`, three agent modules (discovery, scoring, sequencing) all coordinating via DB |
| 5. Newsletter | `daily_notes`, `newsletter_drafts`, `newsletter_issues`, `subscribers`, Resend integration, Claude prompt that turns notes → 300-word draft |
| 6. Content Brand | `social_posts`, page that takes a newsletter issue and emits LinkedIn / X / short-video variants |
| 7. SaaS | OUTLINE ONLY — multi-tenant decisions (auth, isolation, billing) |

---

## Tools / external services you'll be signing up for as you progress

| Unit | Service | Why |
|---|---|---|
| 4. Lead Gen | DAT Power, Apollo.io, Carrier411, or FMCSA SAFER scraping | Shipper discovery (recommend FMCSA + LinkedIn scraping first — free) |
| 4. Lead Gen | Already have: Anthropic API | Scoring + research |
| 5. Newsletter | **Resend** (recommended) — `RESEND_API_KEY` | Transactional email send. $0 for first 3K emails/month, then $20/mo for 50K. SMTP-less. |
| 5. Newsletter | OR Loops, ConvertKit | Alternative if you want a hosted subscriber UI |
| 6. Content Brand | None | Pure Claude — repurpose newsletter to social locally |

---

## Recommended pre-flight before starting Unit 1

1. Read the existing `docs/BUILD_PLAN.md` and accept that R5 is being replaced
2. Confirm Turso is connected and contacts table has data (you can migrate from Mac SQLite or import a CSV first)
3. Confirm the Anthropic API key is saved (Settings → ●●●●●●●●xxxx visible)
4. Make a Turso DB backup before Unit 1 (Diagnostics ⌘⇧D → Export everything)

If all four are ✓, open `01_brokerage_core.md` and start.
