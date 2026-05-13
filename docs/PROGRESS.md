# Build Progress

Last updated: 2026-05-13

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
- [ ] `src/lib/import-parse.ts` — CSV/XLSX parsing (PapaParse + SheetJS)
- [ ] `src/lib/paste-parse.ts` — regex extraction from unstructured text

### State (Zustand)
- [ ] `src/store/contacts.ts`
- [ ] `src/store/ui.ts`
- [ ] `src/store/sync.ts`

### Hooks
- [ ] `src/hooks/useKeyboard.ts`
- [ ] `src/hooks/useToast.ts`
- [ ] `src/hooks/useContacts.ts`
- [ ] `src/hooks/useActivities.ts`
- [ ] `src/hooks/useSync.ts`

---

## Phase 3 — UI Components

### Common
- [ ] `src/components/common/ErrorBoundary.tsx`
- [ ] `src/components/common/Toast.tsx`
- [ ] `src/components/common/Modal.tsx`
- [ ] `src/components/common/SyncDot.tsx`
- [ ] `src/components/common/StartupCheck.tsx`

### Layout
- [ ] `src/components/layout/AppShell.tsx`
- [ ] `src/components/layout/Sidebar.tsx`
- [ ] `src/components/layout/StatusBar.tsx`
- [ ] `src/components/layout/CommandPalette.tsx`

### Contacts
- [ ] `src/components/contacts/ContactList.tsx`
- [ ] `src/components/contacts/ContactRow.tsx`
- [ ] `src/components/contacts/ContactDetail.tsx`
- [ ] `src/components/contacts/ContactForm.tsx`
- [ ] `src/components/contacts/ContactFilters.tsx`

### Activities
- [ ] `src/components/activities/QuickCallModal.tsx`
- [ ] `src/components/activities/ActivityFeed.tsx`

### Dashboard
- [ ] `src/components/dashboard/StatsRow.tsx`
- [ ] `src/components/dashboard/FollowUpQueue.tsx`
- [ ] `src/components/dashboard/USHeatmap.tsx`

### Import
- [ ] `src/components/import/ImportHub.tsx`
- [ ] `src/components/import/DropZone.tsx`
- [ ] `src/components/import/ColumnMapper.tsx`
- [ ] `src/components/import/ImportReview.tsx`
- [ ] `src/components/import/MergeDialog.tsx`
- [ ] `src/components/import/ImportHistory.tsx`
- [ ] `src/components/import/PasteParser.tsx`
- [ ] `src/components/import/ImageOCR.tsx`
- [ ] `src/components/import/QuickAddForm.tsx`

### Diagnostics
- [ ] `src/components/diagnostics/DiagnosticsPanel.tsx`

---

## Phase 4 — Views & Routing

- [ ] `src/views/DashboardView.tsx`
- [ ] `src/views/ContactsView.tsx`
- [ ] `src/views/ContactDetailView.tsx`
- [ ] `src/views/ImportView.tsx`
- [ ] `src/views/SettingsView.tsx`
- [ ] `src/App.tsx` — router + global keyboard shortcuts

---

## Phase 5 — Build Verification

- [ ] `cargo check` passes clean
- [ ] `npm run build` passes clean
- [ ] Auto-fix loop completed (up to 5× per error)
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
- [ ] `README.md` — update/fix workflow

---

## Known Issues / Blockers

_None currently._

---

## Commit Log

| Commit | Description |
|--------|-------------|
| (initial) | Project scaffold |
| docs: persistent build spec | BUILD_PLAN.md, WRITING_RULES.md, PROGRESS.md |
