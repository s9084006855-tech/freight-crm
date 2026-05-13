# Build Progress

Last updated: 2026-05-13 (commit 7c6f62e)

## Legend
- `[x]` Done
- `[-]` In progress
- `[ ]` Not started

---

## Phase 1 — Rust Backend

### Infrastructure
- [x] `src-tauri/Cargo.toml` — all dependencies
- [x] `src-tauri/tauri.conf.json` — window config, resource bundles, permissions
- [x] `src-tauri/build.rs` — Swift helper compile step
- [x] `src-tauri/src/lib.rs` — AppState, bootstrap, local_config.json
- [x] `src-tauri/src/db.rs` — schema v1 (10 tables), WAL, migrations
- [x] `src-tauri/src/models.rs` — all Rust structs

### Commands
- [x] `src-tauri/src/commands/contacts.rs` — CRUD, search, dynamic filter
- [x] `src-tauri/src/commands/activities.rs` — log, fetch, dashboard stats, follow-ups
- [x] `src-tauri/src/commands/import.rs` — sessions, commit, rollback, mapping templates
- [x] `src-tauri/src/commands/keychain.rs` — store, masked get, delete
- [x] `src-tauri/src/commands/ocr.rs` — Apple Vision first, Tesseract fallback, PDF render
- [x] `src-tauri/src/commands/sync.rs` — lock file, refresh, backup, force unlock
- [x] `src-tauri/src/commands/diagnostics.rs` — integrity check, vacuum, error log, export backup
- [x] `src-tauri/src/commands/settings.rs` — get/update settings, initialize DB
- [x] `src-tauri/src/commands/startup.rs` — 5-check startup, auto_repair

### OCR / Swift
- [x] `src-tauri/swift/vision_ocr.swift` — image OCR, PDF page render, PDF text
- [x] `scripts/bundle_tesseract.sh` — binary + dylibs bundled, paths fixed

---

## Phase 2 — Frontend Infrastructure

### Config
- [x] `vite.config.ts` — Tailwind v4 plugin
- [x] `src/index.css` — Tailwind v4, theme tokens, dark UI base

### Types
- [x] `src/types/index.ts` — all TypeScript interfaces

### Lib
- [x] `src/lib/db.ts` — all invoke wrappers
- [x] `src/lib/phone.ts` — normalize, format, validate, match
- [x] `src/lib/dedup.ts` — Levenshtein, nameSimilarity, findDuplicate, classifyRow
- [x] `src/lib/errors.ts` — logError, logWarn, humanError
- [x] `src/lib/import-parse.ts` — CSV/XLSX parsing (PapaParse + SheetJS)
- [x] `src/lib/paste-parse.ts` — regex extraction from unstructured text

### State (Zustand)
- [x] `src/store/contacts.ts`
- [x] `src/store/ui.ts`
- [x] `src/store/sync.ts`

### Hooks
- [x] `src/hooks/useKeyboard.ts`
- [x] `src/hooks/useToast.ts`
- [x] `src/hooks/useContacts.ts`
- [x] `src/hooks/useActivities.ts`
- [x] `src/hooks/useSync.ts`

---

## Phase 3 — UI Components

### Common
- [x] `src/components/common/ErrorBoundary.tsx`
- [x] `src/components/common/Toast.tsx`
- [x] `src/components/common/Modal.tsx`
- [x] `src/components/common/SyncDot.tsx`
- [x] `src/components/common/StartupCheck.tsx`

### Layout
- [x] `src/components/layout/AppShell.tsx`
- [x] `src/components/layout/Sidebar.tsx`
- [x] `src/components/layout/StatusBar.tsx`
- [x] `src/components/layout/CommandPalette.tsx`

### Contacts
- [x] `src/components/contacts/ContactList.tsx`
- [x] `src/components/contacts/ContactRow.tsx`
- [x] `src/components/contacts/ContactDetail.tsx`
- [x] `src/components/contacts/ContactForm.tsx`
- [x] `src/components/contacts/ContactFilters.tsx`

### Activities
- [x] `src/components/activities/QuickCallModal.tsx`
- [x] `src/components/activities/ActivityFeed.tsx`

### Dashboard
- [x] `src/components/dashboard/StatsRow.tsx`
- [x] `src/components/dashboard/FollowUpQueue.tsx`
- [x] `src/components/dashboard/USHeatmap.tsx`

### Import
- [x] `src/components/import/ImportHub.tsx`
- [x] `src/components/import/DropZone.tsx`
- [x] `src/components/import/ColumnMapper.tsx`
- [x] `src/components/import/ImportReview.tsx`
- [x] `src/components/import/MergeDialog.tsx`
- [x] `src/components/import/ImportHistory.tsx`
- [x] `src/components/import/PasteParser.tsx`
- [x] `src/components/import/ImageOCR.tsx`
- [x] `src/components/import/QuickAddForm.tsx`

### Diagnostics
- [x] `src/components/diagnostics/DiagnosticsPanel.tsx`

---

## Phase 4 — Views & Routing

- [x] `src/views/DashboardView.tsx`
- [x] `src/views/ContactsView.tsx`
- [x] `src/views/ContactDetailView.tsx`
- [x] `src/views/ImportView.tsx`
- [x] `src/views/SettingsView.tsx`
- [x] `src/App.tsx` — router + global keyboard shortcuts

---

## Phase 5 — Build Verification

- [x] `cargo check` passes clean
- [x] `npm run build` passes clean
- [x] Auto-fix loop completed (up to 5× per error)
- [ ] App launches on Mac mini
- [ ] App launches on MacBook Air
- [ ] iCloud sync tested between two machines
- [ ] OCR tested with sample business card image
- [ ] CSV import tested end-to-end
- [ ] XLSX import tested end-to-end
- [ ] Rollback tested

---

## Phase 6 — Docs

- [x] `docs/BUILD_PLAN.md`
- [x] `docs/WRITING_RULES.md`
- [x] `docs/PROGRESS.md` (this file)
- [x] `README.md` — update/fix workflow

---

## Known Issues / Blockers

_None currently._

---

## Commit Log

| Commit | Description |
|--------|-------------|
| (initial) | Project scaffold |
| da57d86 docs: persistent build spec | BUILD_PLAN.md, WRITING_RULES.md, PROGRESS.md |
| 7c6f62e feat: complete frontend + fix all build errors | All React components, views, stores, hooks; cargo check + npm build clean |
