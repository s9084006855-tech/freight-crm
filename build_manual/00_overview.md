# AFUO Freight Empire — Build Manual

This is a how-to. Not a plan, not a vision document. Each unit is a sequence of 30-minute steps with real code and real SQL. You can read it solo or feed individual units to Claude Code to execute one at a time.

---

## Who this is for

Francisco Pelaez — one-person produce freight brokerage (MC 1136566, DOT 3471790, SCAC AFUO). Building toward the Disney 1957 strategy map vision: brokerage core in the middle, six other units feeding it and feeding each other.

---

## Read this first

→ [00_audit.md](./00_audit.md) — what already exists in the codebase, what's stubbed, what conflicts with the plan, what tables are missing per unit. **Read before writing or executing any unit.**

---

## The seven units (in build order)

Order is set by **technical dependency**, not strategic priority. You can't build the lead gen agents before the CRM tables they write into exist. You can't build the SaaS before the single-user version is hardened.

| # | Unit | File | Why now | Est. hours |
|---|---|---|---|---|
| 1 | Brokerage core | [01_brokerage_core.md](./01_brokerage_core.md) | Loads + shipper records are the data foundation. Everything else reads from this. | 20–30 |
| 2 | CRM (pipeline + rate cons) | [02_crm.md](./02_crm.md) | Pipeline is what turns prospects into shippers. Rate cons close the booking loop. | 25–40 |
| 3 | Customer Success | [03_customer_success.md](./03_customer_success.md) | "Needs follow-up" view is cheap to build and the highest-ROI retention tool you'll have. | 12–18 |
| 4 | Lead Gen Subagents | [04_lead_gen_subagents.md](./04_lead_gen_subagents.md) | Discovery / scoring / sequencing agents — needs CRM tables to write into. | 30–40 |
| 5 | Newsletter | [05_newsletter.md](./05_newsletter.md) | Claude-powered draft from your daily notes + Resend send. The owned-audience asset. | 20–30 |
| 6 | Content Brand | [06_content_brand.md](./06_content_brand.md) | Repurpose newsletter into LinkedIn/X variants. Lighter weight than newsletter. | 10–15 |
| 7 | SaaS | [07_saas.md](./07_saas.md) | **Outline only.** Multi-tenant decisions to make later. Do not start until Units 1–6 are running daily. | n/a (decision doc) |

**Total focused work, Units 1–6: ~120–180 hours** (≈ 8–12 weeks at 15 hrs/week).

---

## How to use this manual

### Solo execution

Open one unit file at a time. Each unit has a `## Step-by-step build` section. Each step is sized to ≤30 minutes. Do one step, run the verification at the bottom of the step, commit, move on.

When you finish a unit, run the unit's `## How to test the whole unit` walkthrough before starting the next.

### Claude Code execution

Each unit file has a `## What to tell Claude Code to build this for me` section. That's a single copy-paste prompt that references the unit file by path. Feed it to a fresh Claude Code session — it'll execute the whole unit autonomously. Watch over its shoulder for the first few steps, then let it run.

If a step requires a decision (e.g. scoring threshold, default follow-up days), the manual presents 2–3 options with a recommendation. Claude Code will pick the recommendation unless you say otherwise in your prompt.

### Hybrid

Use Claude Code for the boring scaffolding (schema migrations, command registration, type definitions) and do the decision-heavy steps (prompt tuning, UI judgment calls) yourself.

---

## Conventions used in every unit file

- **Files paths are absolute** from the project root: `src-tauri/src/commands/loads.rs`, not `./commands/loads.rs`
- **SQL is shown in full** — column names, types, defaults, indexes. Copy-paste-runnable.
- **Code is shown in full** — no `// TODO: implement` without explaining what goes in the TODO
- **Env vars** are always uppercase snake (`RESEND_API_KEY`) and the manual says exactly where to put them (`local_config.json`, Settings UI, or `.env`)
- **Verification** at the end of every step is a concrete action you take, not "run tests"
- **Decisions** are presented as labelled options (A / B / C) with a recommendation

---

## Things this manual does NOT do

- Does not write tests. Manual walkthroughs only. If you want unit tests, ask Claude Code separately to add them per unit.
- Does not propose stack changes. React + Turso + Tauri is the stack. Anything that contradicts that is wrong.
- Does not pre-build the SaaS. Unit 7 is decisions only — no code until you have ≥6 months of single-user data and ≥10 freight contacts asking to try it.
- Does not assume bulk hiring or contractors. Sized for you alone, 10–15 focused hours per week.

---

## Cross-cutting concerns (applied in every unit)

1. **Every Tauri command** must be registered in `src-tauri/src/lib.rs` invoke_handler. Easy to forget. Verify with a frontend invoke call before declaring the step done.
2. **Every new TS interface** goes in `src/types/index.ts`. Don't define types inline in components.
3. **Every new Rust struct** that crosses the FFI boundary needs `#[derive(Serialize, Deserialize)]` in `src-tauri/src/models.rs`.
4. **Every new DB table** must be added inside `apply_v3()` (or `v4`, `v5`...) in `src-tauri/src/db.rs`, then the version bump in `init_schema_async`. **Don't add tables anywhere else** — Turso has no `IF NOT EXISTS` safety net on column adds.
5. **Every Claude API call** must (a) read the key via `crate::commands::keychain::get_raw_api_key()`, (b) use prompt caching on the system prompt, (c) handle the "no key configured" path with a clear error toast.
6. **Every new sidebar nav item** goes in `src/components/layout/Sidebar.tsx` with a keyboard shortcut registered in `src/App.tsx`.

---

## When you're done with a unit

1. Commit on a feature branch (`feature/unit-N-name`)
2. Update `docs/PROGRESS.md` — check off the unit
3. Tag the commit (`unit-1-complete`, `unit-2-complete`, ...)
4. Move to the next unit file

When all six functional units are done and have ≥30 days of real use, open `07_saas.md` and start the multi-tenant decision process.
