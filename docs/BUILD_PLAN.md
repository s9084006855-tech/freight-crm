# Freight CRM — Master Build Plan

**Owner:** Francisco Pelaez  
**MC:** 1136566 · **DOT:** 3471790 · **SCAC:** AFUO  
**Last updated:** 2026-05-13  
**Status:** In active development

---

## PURPOSE

A personal desktop CRM for a one-person produce freight brokerage specializing in last-minute, last-mile emergency coverage. Built for cold-calling produce shippers and receivers all day. Not a team tool — single user, two Macs, synced via iCloud Drive.

---

## TECH STACK

| Layer | Choice | Reason |
|-------|--------|--------|
| Desktop shell | Tauri 2.x | Lightweight, Rust backend, native macOS |
| Frontend | React 19 + TypeScript + Tailwind CSS v4 | |
| State | Zustand | Lightweight, no boilerplate |
| Database | SQLite via `rusqlite` (bundled) | Offline-first, single file = easy iCloud sync |
| Sync | iCloud Drive file sync | No server, no subscription |
| Keychain | `keyring` Rust crate v3 (macOS Keychain Services) | Hard requirement |
| OCR primary | Apple Vision framework (via bundled Swift helper) | Built into every Mac, best quality |
| OCR fallback | Bundled Tesseract binary + dylibs | Hard requirement — must be bundled, not installed |
| PDF text | `pdf-extract` Rust crate | Text-based PDFs |
| PDF rasterize | `CGPDFDocument` via Swift helper | Built into macOS, no extra bundling |
| CSV parse | PapaParse (npm) | Auto-delimiter detection |
| Excel parse | SheetJS/xlsx (npm) | Handles .xlsx and .xls |

---

## HARD REQUIREMENTS (NON-NEGOTIABLE)

### R1: No code generated without plan approval
Plan must be approved in writing before any code generation starts. If a new feature request arrives mid-build, stop, update the plan, get approval, then resume.

### R2: All user data in the synced SQLite DB
Every table that holds user data lives in `freight_crm.sqlite` at the sync path. No JSON files, no YAML, no separate per-feature config files.

**Allowed outside the synced DB:**
| Item | Location |
|------|----------|
| App binary | `/Applications/` |
| Tesseract binary + tessdata | `.app/Contents/Resources/tesseract/` |
| Apple Vision Swift helper | `.app/Contents/Resources/vision_ocr` |
| Error log | `~/Library/Application Support/freight-crm/error.log` (machine-specific) |
| Anthropic API key | macOS Keychain |
| Bootstrap config | `~/Library/Application Support/freight-crm/local_config.json` (device_id, device_name, db_path, last_seen_write_time — machine-specific by design) |

### R3: Anthropic API key in macOS Keychain only
- Rust crate: `keyring = "3"` — uses Keychain Services natively
- Service name: `"freight-crm-anthropic"`, account: `"api-key"`
- Frontend never receives the raw key after storage
- Settings UI: paste key → stored immediately → shows `"••••••••{last4}"` + [Remove] button
- If Keychain fails: surface the exact OS error — do not fall back to plaintext

### R4: Tesseract bundled in `.app/Contents/Resources/`
- Binary: universal (arm64 + x86_64) or single-arch matching build machine
- All dylib dependencies copied and `install_name_tool`-fixed
- `eng.traineddata` bundled in `Resources/tesseract/tessdata/`
- Build script: `scripts/bundle_tesseract.sh` — run once before `cargo tauri build`
- Startup self-test: invoke Tesseract on `test_asset.png`; failure shows diagnostic, NOT "install Tesseract"
- Requires Homebrew on developer machine only — not on end-user machine

### R5: No loads tracking / rate confirmations
This is a business acquisition CRM only. TMS system handles loads separately. No loads table, no rate confirmation docx generation.

---

## APPROVED TECHNICAL DECISIONS

1. **OCR engine order:** Apple Vision runs first (always). If Vision fails OR confidence < 70%, try Tesseract. Return best result. Log which engine was used per job (visible in Diagnostics panel). User never chooses — app picks automatically.

2. **PDF rasterization:** Use `CGPDFDocument` via the bundled Swift Vision helper (`vision_ocr pdf-text <path>`). Built into macOS — zero extra bundling.

3. **Paste text enhancement:** Button labeled "Enhance with Claude" — opt-in per paste. Button only appears when an Anthropic API key is configured in Keychain. Shows `~$0.001 per paste` cost estimate next to button. Settings toggle "Auto-enhance pasted text" (default OFF) allows making it automatic later.

4. **Rollback confirmation dialog exact wording:**
   > "This will remove **[N] contacts** added on **[date]** from **[source file]**. Any edits you've made to those contacts since import will be lost. Contacts added or edited from other sources are not affected. Continue?"
   
   [N] and [date] must be bold. Two buttons: [Cancel] and [Rollback].

5. **OCR confidence threshold:** 70% (0.70). Any parsed field with confidence < 0.70 flags the row yellow in the import review screen. Low-confidence rows are never auto-discarded — only flagged for review.

6. **API key storage:** macOS Keychain exclusively. No fallback to any other storage mechanism. If Keychain is unavailable, surface the error and stop.

---

## FILE / FOLDER ARCHITECTURE

```
freight-crm/
├── docs/
│   ├── BUILD_PLAN.md          ← this file
│   ├── WRITING_RULES.md       ← communication style + freight formats
│   └── PROGRESS.md            ← living checklist with commit hashes
├── scripts/
│   └── bundle_tesseract.sh    ← run once before first cargo tauri build
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs               ← compiles swift/vision_ocr.swift → resources/vision_ocr
│   ├── entitlements.plist
│   ├── capabilities/
│   │   └── default.json
│   ├── resources/
│   │   └── tesseract/         ← populated by bundle_tesseract.sh
│   │       ├── tesseract      (universal binary)
│   │       ├── lib/           (bundled dylibs)
│   │       ├── tessdata/
│   │       │   └── eng.traineddata
│   │       └── test_asset.png (1px white PNG for self-test)
│   └── src/
│       ├── main.rs
│       ├── lib.rs             ← app builder, AppState, command registration
│       ├── db.rs              ← connection, schema, migrations
│       ├── models.rs          ← all Rust structs with serde
│       └── commands/
│           ├── mod.rs         ← normalize_company, normalize_phone, conn_err helpers
│           ├── contacts.rs    ← CRUD + search
│           ├── activities.rs  ← call log, follow-ups, dashboard stats
│           ├── import.rs      ← session management, commit, rollback, templates
│           ├── ocr.rs         ← Vision + Tesseract invocation, engine selection
│           ├── sync.rs        ← lock file, backup, refresh, sync status
│           ├── diagnostics.rs ← integrity check, vacuum, error log, export
│           ├── settings.rs    ← app_settings CRUD, reinitialize DB
│           ├── keychain.rs    ← store/get/delete API key via keyring crate
│           └── startup.rs     ← startup self-test, auto-repair
├── src/
│   ├── main.tsx
│   ├── App.tsx                ← router + global keyboard shortcuts
│   ├── index.css              ← Tailwind v4 + CSS vars (dark theme)
│   ├── types/
│   │   └── index.ts           ← all TypeScript interfaces
│   ├── lib/
│   │   ├── db.ts              ← typed invoke() wrappers
│   │   ├── errors.ts          ← logError, humanError helpers
│   │   ├── phone.ts           ← normalizePhone, formatPhone, phonesMatch
│   │   ├── import-parse.ts    ← CSV/XLSX parsing (PapaParse + SheetJS)
│   │   ├── paste-parse.ts     ← regex extraction from unstructured text
│   │   └── dedup.ts           ← fuzzy name match + phone dedup logic
│   ├── store/
│   │   ├── contacts.ts        ← Zustand: contact list, selected contact
│   │   ├── ui.ts              ← Zustand: active view, open modals, toasts
│   │   └── sync.ts            ← Zustand: sync status, polling
│   ├── hooks/
│   │   ├── useContacts.ts
│   │   ├── useActivities.ts
│   │   ├── useSync.ts
│   │   ├── useKeyboard.ts
│   │   └── useToast.ts
│   ├── components/
│   │   ├── common/
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── Toast.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── SyncDot.tsx
│   │   │   └── StartupCheck.tsx
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   └── CommandPalette.tsx
│   │   ├── contacts/
│   │   │   ├── ContactList.tsx
│   │   │   ├── ContactRow.tsx
│   │   │   ├── ContactDetail.tsx
│   │   │   ├── ContactForm.tsx
│   │   │   └── ContactFilters.tsx
│   │   ├── activities/
│   │   │   ├── QuickCallModal.tsx
│   │   │   └── ActivityFeed.tsx
│   │   ├── dashboard/
│   │   │   ├── StatsRow.tsx
│   │   │   ├── FollowUpQueue.tsx
│   │   │   └── USHeatmap.tsx
│   │   ├── import/
│   │   │   ├── ImportHub.tsx
│   │   │   ├── DropZone.tsx
│   │   │   ├── ColumnMapper.tsx
│   │   │   ├── ImportReview.tsx
│   │   │   ├── MergeDialog.tsx
│   │   │   ├── ImportHistory.tsx
│   │   │   ├── PasteParser.tsx
│   │   │   ├── ImageOCR.tsx
│   │   │   └── QuickAddForm.tsx
│   │   └── diagnostics/
│   │       └── DiagnosticsPanel.tsx
│   └── views/
│       ├── DashboardView.tsx
│       ├── ContactsView.tsx
│       ├── ContactDetailView.tsx
│       ├── ImportView.tsx
│       └── SettingsView.tsx
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## DATABASE SCHEMA

```sql
-- CONTACTS
CREATE TABLE contacts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  bbid                  TEXT UNIQUE,
  company_name          TEXT NOT NULL,
  company_name_search   TEXT NOT NULL,      -- normalized: lowercase, no punctuation
  website               TEXT,
  phone                 TEXT,
  phone_normalized      TEXT,               -- digits only, for dedup
  fax                   TEXT,
  email                 TEXT,
  street                TEXT,
  city                  TEXT,
  state                 TEXT,
  zip                   TEXT,
  country               TEXT DEFAULT 'USA',
  roles                 TEXT,               -- "Shipper,Receiver,Distributor"
  commodities           TEXT,               -- "Apple,Citrus,Onion"
  status                TEXT NOT NULL DEFAULT 'active',  -- active|inactive|do_not_call
  priority              INTEGER NOT NULL DEFAULT 0,      -- 0=normal 1=warm 2=hot
  source                TEXT NOT NULL DEFAULT 'manual',  -- bluebook|excel|manual|import
  notes                 TEXT,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  last_contacted_at     INTEGER
);

-- CONTACT PEOPLE
CREATE TABLE contact_people (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id   INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  title        TEXT,
  phone        TEXT,
  mobile       TEXT,
  email        TEXT,
  is_primary   INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ACTIVITIES
CREATE TABLE activities (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id       INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,    -- call|note|email|follow_up
  outcome          TEXT,             -- reached|voicemail|busy|no_answer|callback
  notes            TEXT,
  duration_sec     INTEGER,
  follow_up_at     INTEGER,
  follow_up_done   INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

-- TAGS
CREATE TABLE tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT UNIQUE NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1'
);
CREATE TABLE contact_tags (
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);

-- IMPORT SESSIONS
CREATE TABLE import_sessions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type         TEXT NOT NULL,   -- excel|csv|pdf|image|paste|manual
  source_name         TEXT,            -- original filename or "Pasted text"
  template_id         INTEGER REFERENCES column_mapping_templates(id),
  started_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at        INTEGER,
  contacts_added      INTEGER NOT NULL DEFAULT 0,
  contacts_merged     INTEGER NOT NULL DEFAULT 0,
  contacts_discarded  INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending', -- pending|completed|rolled_back
  notes               TEXT
);

-- IMPORT SESSION CONTACTS (enables per-session rollback)
CREATE TABLE import_session_contacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,   -- added|merged|discarded
  previous_data   TEXT,            -- JSON snapshot of contact before merge
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- COLUMN MAPPING TEMPLATES (synced across Macs via same DB)
CREATE TABLE column_mapping_templates (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL UNIQUE,   -- "Blue Book format"
  source_type          TEXT NOT NULL,           -- excel|csv
  mapping_json         TEXT NOT NULL,           -- {"0":"company_name","1":"phone",...}
  header_fingerprint   TEXT,                    -- SHA256 of sorted header list
  sample_headers       TEXT,                    -- JSON array shown in UI
  created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at         INTEGER
);

-- PARSING LOGS
CREATE TABLE parsing_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  row_index    INTEGER,
  raw_data     TEXT,        -- JSON of original row
  parsed_data  TEXT,        -- JSON of normalized fields
  issues       TEXT,        -- JSON array of issue strings
  confidence   REAL,        -- 0.0–1.0 (OCR/paste); NULL for structured sources
  status       TEXT NOT NULL DEFAULT 'pending'  -- pending|kept|merged|discarded
);

-- SYNC METADATA
CREATE TABLE sync_metadata (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Keys: last_device_id, last_device_name, last_write_time, schema_version, app_version

-- ERROR LOG
CREATE TABLE error_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  level      TEXT NOT NULL,  -- error|warn|info
  context    TEXT,
  message    TEXT NOT NULL,
  stack      TEXT,
  device_id  TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- APP SETTINGS
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys: sync_path, sync_provider, device_name (overridden by local_config),
--       theme, last_import_at, mc_number, dot_number, scac,
--       claude_vision_enabled, auto_enhance_paste

-- SCHEMA MIGRATIONS
CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
```

---

## SCREENS & NAVIGATION

| # | View | Shortcut | Contents |
|---|------|----------|----------|
| 1 | Dashboard | `Cmd+1` | Follow-up queue · Calls today · Stats row · US contact heatmap |
| 2 | Contacts | `Cmd+2` | Virtualized list · search · filter chips · J/K nav |
| 3 | Contact Detail | `Enter` from list | Profile · people · activity timeline · quick-call button |
| 4 | Import Hub | `Cmd+I` / `Cmd+3` | Tabbed: Excel/CSV · PDF · Image · Paste · Quick Add · History |
| 5 | Settings | `Cmd+4` | Sync path · API key · device name · MC/DOT/SCAC · theme |
| 6 | Quick Call Modal | `Cmd+L` | Floating overlay — available everywhere |
| 7 | Command Palette | `Cmd+K` | Floating overlay — available everywhere |
| 8 | Diagnostics Panel | `Cmd+Shift+D` | Overlay — available everywhere |
| 9 | Startup Self-Test | Auto on failure | One-time check screen with auto-repair buttons |

### Import Hub — tabs

| Tab | Input method | Flow |
|-----|-------------|------|
| Excel / CSV | File picker or drag-drop | Parse → Column Mapper → Review |
| PDF | File picker or drag-drop | Text extract → (OCR if scanned) → Review |
| Image / Screenshot | File picker or drag-drop | OCR → confidence score → Review; [Try Claude Vision] if key set + low confidence |
| Paste Text | Cmd+V or click | Paste box → local regex → [Enhance with Claude] button → Review |
| Quick Add | Form | Single contact, Tab/Enter to save — no review screen |
| Import History | Table | Log with [Rollback] buttons per session |

---

## KEYBOARD SHORTCUTS

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Command palette |
| `Cmd+L` | Quick call log modal |
| `Cmd+N` | New contact |
| `Cmd+I` | Open Import Hub |
| `Cmd+Shift+N` | Quick Add single contact |
| `Cmd+F` | Focus search |
| `Cmd+Shift+D` | Diagnostics panel |
| `Cmd+1` | Dashboard |
| `Cmd+2` | Contacts list |
| `Cmd+3` | Import Hub |
| `Cmd+4` | Settings |
| `J / K` | Navigate list down/up |
| `Enter` | Open focused contact |
| `Esc` | Close modal / go back |
| `Cmd+S` | Save current form |
| `Cmd+Backspace` | Delete with confirm |
| `Tab / Shift+Tab` | Next/prev field in forms |
| `Cmd+V` (in Import Hub) | Activate Paste tab |
| `/` | Focus search from list |

---

## MULTI-MAC SYNC DESIGN

### Sync path
- Default: `~/Library/Mobile Documents/com~apple~CloudDocs/FreightCRM/freight_crm.sqlite`
- Configurable in Settings: any folder path (Dropbox, external drive, etc.)
- Stored in `app_settings.sync_path` (in DB) and `local_config.json` (bootstrap)

### On every app launch
1. Read `local_config.json` → get `db_path` and `last_seen_write_time`
2. Open SQLite connection to DB at `db_path`
3. Read `sync_metadata.last_write_time` from DB
4. If `last_write_time > last_seen_write_time` AND `last_device_id ≠ this_device_id`:
   - Backup DB to `{sync_path}/backups/freight_crm_{timestamp}.sqlite`
   - Reopen connection (gets iCloud's latest version)
   - Update `last_seen_write_time` in `local_config.json`
   - Show yellow sync dot briefly

### On every write
- After DB mutation: `UPDATE sync_metadata` with `last_device_id`, `last_device_name`, `last_write_time`
- Write updated `last_seen_write_time` to `local_config.json`

### Lock file
- File: `{sync_path}/.freight_crm.lock` — JSON: `{device_id, device_name, locked_at}`
- Written on app launch; deleted on app quit
- Stale if `locked_at` > 15 minutes ago
- If another device's non-stale lock exists: warn "Database is open on [device]. Continue anyway?" + [Force Unlock]

### Sync status indicator (bottom-right of status bar)
| Dot color | Meaning |
|-----------|---------|
| Green | This device wrote last — in sync |
| Yellow | Other device wrote — just refreshed |
| Red | Sync folder inaccessible or iCloud unavailable |

### Backup retention
- Keep last 10 backups; auto-delete older ones

### Conflict note
File-based sync means last write wins. The lock file is advisory, not a hard block. This is a known limitation of SQLite + iCloud file sync — acceptable for a single-user app where simultaneous dual-machine writes are rare.

### Column mapping template sync example
1. Mac mini: complete Blue Book import → "Blue Book format" template saved to `column_mapping_templates` in DB → iCloud syncs DB
2. MacBook Air (10 min later): app launches → detects newer `last_write_time` from Mac mini → refreshes → template is now available in Column Mapper automatically

---

## IMPORT SYSTEM

### Source types
1. **Excel (.xlsx, .xls)** — SheetJS, auto-detect columns by header + content sniff, Column Mapper, save templates
2. **CSV / TSV** — PapaParse, same flow, auto-delimiter detection
3. **PDF** — `pdf-extract` for text PDFs; if < 100 chars/page assume scanned → `vision_ocr pdf-text` for OCR
4. **Images / Screenshots** — Apple Vision first, Tesseract fallback, confidence threshold 70%
5. **Pasted Text** — local regex parser (phones, emails, addresses, company names); optional Claude API enhancement
6. **Quick Add** — single-contact form, no review screen, instant save with 5-second undo toast

### Column auto-detection
Priority order:
1. Exact header match (case-insensitive): `company`, `company name`, `phone`, `email`, etc.
2. Fuzzy header match: `org` → company, `tel` → phone, `mobile` → phone, etc.
3. Content sniffing: column of 10-digit numbers → phone; column of `x@x.x` patterns → email; 2-char uppercase → state

### Universal review flow (all sources → same screen)
- **Green rows:** clean new contact, no issues
- **Yellow rows:** potential duplicate (fuzzy name match or phone match) OR confidence < 70%
- **Red rows:** parsing error (missing company, invalid phone, malformed data)
- Per-row actions: Keep / Merge / Discard / Edit
- Merge pulls up field-by-field comparison — toggle per field which value wins
- Bulk actions: "Keep all green" / "Discard all red" / "Review all yellow"
- Final summary before commit: "Adding N, merging M, discarding P. Proceed?"

### Import history & rollback
- Every import creates a row in `import_sessions`
- Every affected contact linked in `import_session_contacts` with `previous_data` JSON snapshot
- Rollback: deletes `added` contacts; restores `merged` contacts from snapshot
- Rollback confirmation dialog uses exact wording from Decision #4 above

---

## ERROR HANDLING & AUTO-FIX FLOW

### Build-time loop (applied during development)
```
Write component
    ↓
Run: cargo check + tsc --noEmit + vite build
    ↓
Pass → continue
Fail → read full error → diagnose root cause → apply fix → re-run
    ↓
Repeat up to 5× per error
Still failing after 5× → stop and ask
```

### Runtime (in app)
- Every async Tauri invoke: wrapped in try/catch → `logError()` to DB → Toast with human message
- Toast message examples: "Couldn't save that note — your changes are still in the field, try again" / "Sync folder not found — check Settings"
- React ErrorBoundary: wraps each view — one broken screen never crashes the whole app
- On startup: `run_startup_check` command checks DB, schema, sync folder, OCR engines — shows StartupCheck screen with per-item status + [Auto-repair] button if anything fails

### Diagnostics panel (`Cmd+Shift+D`)
- DB integrity check result (`PRAGMA integrity_check`)
- Sync status (last sync time, last device name)
- OCR engine status (which engines available, last test result)
- Recent errors (last 20 from `error_log`)
- [Repair DB] → VACUUM + integrity_check
- [Re-import contacts] → opens Import Hub
- [Export everything] → copies DB + exports CSV to Desktop/FreightCRM_Backup/
- App version + schema version + device info

---

## DATA IMPORT — INITIAL SEED

### Source files (first run)
| File | Rows | Notes |
|------|------|-------|
| `BBOS CompanyContact Export.csv` | 250 | Blue Book export — company-level, no individual contacts |
| `Clients List.xlsx` | 78 | Personal list — company + phone + state, 1 named contact |

### Field mapping: Blue Book CSV → contacts
| CSV | DB field |
|-----|----------|
| BBID | bbid |
| Company | company_name |
| Phone | phone (+ phone_normalized) |
| Fax | fax |
| Email | email |
| WebPage | website |
| MailingCity/State/Zip | city/state/zip |
| MailingStreet1 | street |
| Classifications | roles |
| Commodities | commodities |
| — | source = 'bluebook' |

### Field mapping: Excel → contacts + contact_people
| Excel | DB field |
|-------|----------|
| Company Name | company_name |
| State | state |
| Phone | phone |
| Contact Name | contact_people.name (if non-empty) |
| Notes | notes |
| — | source = 'excel' |

### Dedup logic
1. Normalize: company name → lowercase, strip punctuation, collapse spaces; phone → digits only, last 10
2. Exact phone match → merge (keep Blue Book record, attach Excel notes)
3. Name similarity ≥ 85% → flag yellow in review
4. Phone match only, different name → flag yellow
5. No match → insert as new green row

---

## UI DESIGN TOKENS

```css
--color-bg:           #0b0b0b   (app background)
--color-surface:      #141414   (cards, panels)
--color-surface-2:    #1c1c1c   (inputs, nested surfaces)
--color-border:       #252525
--color-border-hover: #343434
--color-text:         #e8e8e8   (primary text)
--color-text-2:       #888      (secondary/muted)
--color-text-3:       #555      (placeholder)
--color-accent:       #5b6ef5   (indigo — CTAs, active states)
--color-green:        #22c55e   (success, clean import rows)
--color-yellow:       #eab308   (warning, duplicate rows)
--color-red:          #ef4444   (error, invalid rows)
--color-blue:         #3b82f6   (informational)
```

Style reference: Linear / Superhuman — dense, keyboard-first, minimal chrome.

---

## BUSINESS CREDENTIALS

- **MC:** 1136566
- **DOT:** 3471790
- **SCAC:** AFUO
- **Specialty:** Produce only — last-minute emergency freight coverage
- **Operation:** One person, cold-calling shippers and receivers

---

*This document is the source of truth. If code diverges from this plan, the plan wins. Update this document whenever a design decision changes.*
