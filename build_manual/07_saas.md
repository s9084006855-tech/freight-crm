# Unit 7 — SaaS (Multi-Tenant Outline)

> **This unit is intentionally outline-only.** No code, no schema, no steps to execute.
> Do not start building until Units 1–6 have been running daily for 6+ months AND
> at least 5 freight contacts have explicitly asked if they can pay to use the CRM.
> "Build it for yourself, hard, for six months" — the BUILD_PLAN.md anchor — applies here doubly.

This file documents the architecture decisions you'll need to make WHEN that day comes, so future-you doesn't start cold.

---

## What "going SaaS" actually means for this codebase

Today's Freight CRM is a single-user Tauri desktop app where:
- The user is hardcoded to one of two profiles (`francisco` / `jack`) in `users.rs`
- All data lives in a single shared Turso database
- The Anthropic API key is stored in the local OS credential vault
- There's no concept of "tenant" — every row belongs to "the user"

Going SaaS means turning that into:
- A web-accessible product where any freight broker can sign up
- Each broker's data is isolated (they cannot see other brokers' contacts, loads, leads)
- A billing layer that charges per seat or per usage
- An auth flow that's not "pick from two hardcoded profiles"

These are four large, independent decisions. Don't try to make them all at once.

---

## Decision 1: Distribution model

**Three credible paths:**

### (A) Stay desktop. Sell licenses, not subscriptions.
- Each customer runs their own Tauri app on their own Mac/PC.
- Each customer brings their own Turso DB + Anthropic API key.
- You ship signed builds + a license server that validates a per-customer key on app launch.
- Pros: Zero infra cost. Customer data isolation is automatic (it's their own DB). Sales motion is one-time payment.
- Cons: Updates are slower (customers must download). Support is harder (you can't see their data). Onboarding requires the customer to set up Turso themselves — high friction.

### (B) Hybrid: desktop app + hosted backend.
- Tauri app stays, but talks to a central API server instead of customer-owned Turso.
- You operate the database. Customer data is rows scoped by `tenant_id`.
- API key for Anthropic/Resend is yours (you bill the customer for usage).
- Auth via OAuth (Google/Microsoft) at app launch — store a per-tenant JWT.
- Pros: Easy updates. You see metrics. Lower onboarding friction.
- Cons: Infra costs scale with users. Data isolation is YOUR responsibility (one SQL bug = breach).

### (C) Pure web. Drop Tauri, rebuild as a Next.js / Remix / Vite SPA.
- All UI is browser-based. Users sign up at app.afuocrm.com.
- Identical backend story to B (multi-tenant Turso or Postgres).
- Pros: No download. Mobile-friendly. Standard SaaS UX.
- Cons: Massive rewrite. You lose all the offline-first / OS-integrated wins (Keychain, file system access, native PDF generation).

**Recommendation when the time comes:** B. The desktop app is already differentiated — a CRM that runs locally and respects your OS — and the existing React + Tauri code base reuses ~80% of work for B. Pure web (C) is a separate product, not an evolution.

---

## Decision 2: Auth model

Three flavors for B/C:

### (a) Email/password with magic links
- Simplest to ship. Resend (already in your stack) does magic links cleanly.
- Best for solo brokers who don't want yet another OAuth login.

### (b) Google / Microsoft OAuth only
- Most freight ops live in Gmail or O365 — they'll have one already.
- Zero passwords to manage. Faster onboarding.

### (c) Both
- Cost: ~1 extra week of work + UX testing both paths.

**Recommendation:** (b) at launch. Add magic-link (a) when a customer asks. Defer (c) indefinitely.

**Implementation primitives:**
- Auth provider: **Clerk** or **WorkOS** (don't roll your own).
- Token: short-lived JWT in memory + refresh token in HttpOnly cookie (web) or Tauri secure storage (desktop).
- On every API call: server validates JWT, extracts `tenant_id`, scopes every SQL query.

---

## Decision 3: Data isolation

Three levels of paranoia, increasing in cost:

### (i) `tenant_id` column on every table, scoped via app-layer query rewriting
- Cheapest. One Turso DB. Every SELECT/UPDATE/DELETE adds `WHERE tenant_id = $current`.
- Risk: one missing WHERE clause = full data breach. Mitigation: middleware that wraps every query, refuses to run without a tenant filter.

### (ii) `tenant_id` + Row-Level Security (RLS)
- Postgres has RLS built-in. Turso doesn't natively (as of this writing — verify when you actually start).
- If migrating off Turso to Postgres becomes worth it for RLS alone, that's the trigger to migrate.

### (iii) One database per tenant
- Highest isolation, highest cost. Each customer = one Turso database created via their API.
- Turso's per-DB pricing makes this only viable above $100/mo per customer.
- Recommended for enterprise tier later, not at launch.

**Recommendation:** Start with (i) + automated tests that try to access cross-tenant rows and assert failure. Move to (ii) if you migrate to Postgres for other reasons. Reserve (iii) for the day a customer asks for "true single-tenant" as a contract requirement.

---

## Decision 4: Billing

Three options ordered by complexity:

### (a) Flat per-seat subscription via Stripe
- Customer pays $X/month per user account.
- Stripe Checkout handles signup → webhook flips a `subscription_status` column.
- API enforces "active subscription" on every request.
- Simplest. Ship this first.

### (b) Usage-based metering
- Per-load, per-Claude-call, per-email-sent counters in `usage_events` table.
- Monthly invoice via Stripe Billing or Lago.
- Best alignment with cost (Claude + Resend are real per-event costs).
- Adds 2–4 weeks of dev.

### (c) Hybrid (seat + usage overage)
- Flat base ($X/mo includes Y Claude calls), then $Z per call above.
- Standard SaaS pricing. Defer until you have signal on customer usage shape.

**Recommendation:** (a) for the first 50 customers. You'll learn pricing the hard way; pivot to (b) or (c) only when usage variance becomes a real cost problem.

**Pricing anchor:** McLeod is $500–2000/seat/month for full TMS. Aljex is $200–500. The cheap end of the small-broker market is $50–100/seat/month. Don't undersell — anything under $50 attracts customers who'll consume more support than they pay for.

---

## Concrete code surface that has to change (when the time comes)

Today (single-user) → SaaS (multi-tenant). Tables that need a `tenant_id` added:

```
contacts, contact_people, activities, tags, contact_tags,
import_sessions, import_session_contacts, column_mapping_templates, parsing_logs,
sync_metadata, error_log, app_settings,
loads, pipeline_stages, pipeline_cards, rate_con_templates, rate_cons,
leads, lead_scores, lead_sources, outbound_queue, subagent_runs,
daily_notes, newsletter_drafts, newsletter_issues, subscribers,
social_posts
```

That's every table the manual creates. The migration to v9 in SaaS-day-1 looks like:

```sql
-- Add tenant_id everywhere
ALTER TABLE contacts ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
-- ... repeat for every table

-- Backfill existing single-user data into tenant 1 (you become tenant 1)
-- No-op since DEFAULT 1 already did it.

-- Add tenants table
CREATE TABLE tenants (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    owner_email     TEXT NOT NULL UNIQUE,
    plan            TEXT NOT NULL DEFAULT 'trial',
    stripe_customer_id TEXT,
    subscription_status TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Users (was hardcoded, now real)
CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'member', -- owner | admin | member
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- API keys per-tenant (BYO + master key for Anthropic)
CREATE TABLE tenant_secrets (
    tenant_id       INTEGER PRIMARY KEY REFERENCES tenants(id),
    anthropic_key_encrypted TEXT,
    resend_key_encrypted    TEXT,
    encrypted_with_kek      TEXT NOT NULL  -- key encryption key id
);
```

---

## Things this unit will NEVER do

- Build a marketing site. Use a separate static site for `app.afuocrm.com` vs `afuocrm.com`.
- Build an admin panel inside the customer app. Run admin via a separate internal app + read-only Turso replica.
- Build customer support inside the app. Use Plain or Front and link to it.
- Build analytics dashboards for customers. Stripe + posthog handle this.

---

## Sequencing when you finally start

Roughly 12–16 weeks of work, sized for a 15hr/week pace:

1. **Weeks 1–2:** Provision Clerk + Stripe accounts. Add `tenant_id` to every table (v9 migration). Backfill yourself as tenant 1.
2. **Weeks 3–4:** Build the server. Choose: Tauri-talks-to-Rust-Axum-server, or rewrite the Rust commands as HTTP endpoints in a separate `freight-crm-api` crate. **Recommendation:** the second — keep desktop and server cleanly separated.
3. **Weeks 5–6:** Add JWT validation middleware + tenant scoping to every query. Write the cross-tenant access test suite FIRST, then make sure it passes.
4. **Weeks 7–8:** Onboarding flow: Clerk → tenant + user creation → Stripe Checkout → webhook → activate.
5. **Weeks 9–10:** BYO-API-key UX. Customers paste their own Anthropic key (encrypted at rest with a KEK). Optionally, you sell "managed" plans where they use yours.
6. **Weeks 11–12:** Billing edge cases: trial expiration, payment failure dunning, downgrade flows.
7. **Weeks 13–14:** Migration tool: existing single-user Turso DB → new multi-tenant cloud DB. You'll be the first user to migrate; do it as a script.
8. **Weeks 15–16:** Launch to the waitlist that's been forming during the 6 months you used the product yourself.

---

## Open questions you don't have to answer yet

- Mobile? (PWA for view-only first; native React Native if loads-on-the-go becomes a real ask.)
- API for power users? (REST/GraphQL — defer until 3+ customers ask.)
- White-label? (Defer until $1M ARR.)
- Marketplace integrations (DAT, Truckstop, McLeod)? (Defer until you've validated the core product.)

---

## What to do RIGHT NOW about SaaS

Nothing. Build Units 1–6. Use them daily. Don't read this file again until December 2026.

If you're tempted to start before then, re-read the SaaS deep-dive in `features/strategy-map/StrategyMap.tsx`:

> Not yet. The single biggest mistake you could make right now is trying to sell this CRM before you've used it for six months on your own freight. The version that exists in your head today is missing the scars that only come from running real loads through it.
