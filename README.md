# Freight CRM

Personal CRM for a one-person produce freight brokerage. Cold-call pipeline, contact management, import from any source, iCloud Drive sync across two Macs.

Built with Tauri 2 (Rust + React/TypeScript), SQLite (offline-first), Tailwind v4.

---

## First-time setup

### Prerequisites

- Rust (stable) — `curl https://sh.rustup.rs -sSf | sh`
- Node 20+ — `brew install node`
- Xcode Command Line Tools — `xcode-select --install`
- Tesseract binary bundled — run `scripts/bundle_tesseract.sh` once on your dev machine after `brew install tesseract tesseract-lang`

### Install dependencies

```bash
npm install --legacy-peer-deps
```

### Run in development

```bash
npm run tauri dev
```

### Build for distribution

```bash
npm run tauri build
```

The signed `.app` and `.dmg` end up in `src-tauri/target/release/bundle/`.

---

## Two-Mac sync setup

1. On each Mac, launch the app once to initialize
2. Go to Settings → iCloud sync path and set it to the same iCloud Drive folder on both machines
   - Default: `~/Library/Mobile Documents/com~apple~CloudDocs/FreightCRM/`
3. The app uses an advisory lock file and last-write-wins merge. Both Macs should not edit simultaneously.

---

## Bundling Tesseract (dev machine only, once)

```bash
brew install tesseract tesseract-lang
bash scripts/bundle_tesseract.sh
```

This copies the Tesseract binary and all dylibs into `src-tauri/resources/tesseract/`, fixes library paths with `install_name_tool`, and runs a self-test. Run it once; the output is checked into git and ships inside the `.app`.

---

## Adding/updating the Anthropic API key

Settings → Anthropic API key → paste your `sk-ant-…` key. Stored in macOS Keychain only — never in the database or any file.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` | Command palette |
| `⌘1` | Dashboard |
| `⌘2` | Contacts |
| `⌘3` | Import |
| `⌘,` | Settings |
| `⌘⇧D` | Diagnostics |
| `C` | Log call (when contact selected) |
| `↑/↓` | Navigate contact list |
| `Enter` | Open selected contact |
| `Escape` | Close modal / go back |

---

## Fixing a bug or adding a feature

1. Make your change
2. Run `cargo check` (Rust errors): `cd src-tauri && cargo check`
3. Run `npm run build` (TypeScript errors): `npm run build`
4. Fix all errors before committing — do not commit a broken build
5. `git add -p && git commit -m "fix: <what and why>"`
6. Update `docs/PROGRESS.md` if a feature is newly complete

### Common error patterns

**rusqlite lifetime errors** — use `.and_then(|rows| rows.collect::<Result<Vec<_>, _>>())` instead of `.map_err(|e| e.to_string())?` on `query_map` results.

**Tauri capability errors** — valid permission names are in `src-tauri/target/debug/build/freight-crm-*/out/`. Check the build error for the full list.

**`app.path()` not found** — add `use tauri::Manager;` to the file.

**touch_sync deadlock** — always call `drop(db)` (or scope the MutexGuard in an IIFE closure) before calling `state.touch_sync()`.

---

## Project structure

```
src/
  App.tsx                  # Root — keyboard shortcuts, view router, sync poller
  components/
    common/                # ErrorBoundary, Toast, Modal, SyncDot, StartupCheck
    layout/                # AppShell, Sidebar, StatusBar, CommandPalette
    contacts/              # ContactList, ContactRow, ContactDetail, ContactForm, ContactFilters
    activities/            # QuickCallModal, ActivityFeed
    dashboard/             # StatsRow, FollowUpQueue, USHeatmap
    import/                # ImportHub, DropZone, ColumnMapper, ImportReview, MergeDialog,
                           #   ImportHistory, PasteParser, ImageOCR, QuickAddForm
    diagnostics/           # DiagnosticsPanel (⌘⇧D)
  views/                   # DashboardView, ContactsView, ContactDetailView, ImportView, SettingsView
  store/                   # contacts.ts, ui.ts, sync.ts (Zustand)
  hooks/                   # useKeyboard, useToast, useContacts, useActivities, useSync
  lib/                     # db.ts, phone.ts, dedup.ts, errors.ts, import-parse.ts, paste-parse.ts
  types/index.ts           # All TypeScript interfaces

src-tauri/
  src/
    lib.rs                 # AppState, bootstrap, local_config.json
    db.rs                  # Schema v1 (10 tables), migrations, WAL
    models.rs              # Rust structs
    commands/              # contacts, activities, import, keychain, ocr, sync,
                           #   diagnostics, settings, startup
  swift/vision_ocr.swift   # Apple Vision OCR helper (compiled by build.rs)
  resources/
    tesseract/             # Bundled Tesseract binary + dylibs (run bundle_tesseract.sh)
    vision_ocr             # Compiled Swift helper (built by cargo build)

docs/
  BUILD_PLAN.md            # Architecture, schema, all approved decisions
  WRITING_RULES.md         # Communication style, email templates, load format
  PROGRESS.md              # Feature checklist (this file)
```

---

## Database location

Default: `~/Library/Mobile Documents/com~apple~CloudDocs/FreightCRM/freight_crm.sqlite`

Machine-local bootstrap config (not synced): `~/Library/Application Support/freight-crm/local_config.json`

Backups (auto, last 10): `<sync_path>/backups/`
