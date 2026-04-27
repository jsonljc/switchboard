# Full Public Self-Serve Launch — Design Spec

> Date: 2026-04-24
> Status: Approved
> Governing audit: `docs/superpowers/specs/2026-04-23-public-launch-audit-results.md`

---

## 1. Goal

Make Switchboard ready for full public self-serve launch: a stranger signs up,
connects integrations, activates Alex, receives real calendar bookings from Meta
Ad leads, and sees ROI — without founder intervention at any step.

## 2. Scope

The audit identified 12 blockers, 29 major gaps, and 10 polish items. Since the
audit, SP2–SP4 fixed 8 items. This spec covers the remaining 5 blockers, 21
gaps, 10 polish items, build health, and ops readiness.

### Already Fixed (out of scope)

| Item                             | Fixed By                                  |
| -------------------------------- | ----------------------------------------- |
| B5 WhatsApp raw paste            | SP2: guided setup + test connection       |
| B6 Go-live wrong records         | SP3: readiness checks + deployment bridge |
| B7 No emergency halt             | SP3: halt/resume with readiness gating    |
| B8 No escalation inbox           | SP3+SP4: inbox with resolve, transcript   |
| G9 Hardcoded "Playbook complete" | SP3: real readiness endpoint              |
| G13 Business facts no validation | SP3: onboarding step added                |
| G17 No conversation browser      | SP4: `/conversations` page with filters   |
| G20 No conversation override     | SP4: take-over/release UI                 |

---

## 3. Approach

Four sequential waves, each independently shippable. Each wave has its own
implementation plan. A launch decision can be made after any wave.

| Wave | Focus                                | Days | Cumulative State               |
| ---- | ------------------------------------ | ---- | ------------------------------ |
| 1    | Foundation (build health + blockers) | 5-7  | Functional free beta           |
| 2    | Credibility (trust + reliability)    | 4-5  | Credible beta                  |
| 3    | Polish + UX gaps                     | 4-5  | Polished product               |
| 4    | Ops readiness                        | 2-3  | Production-grade public launch |

Total estimate: 15-20 days.

---

## 4. Wave 1 — Foundation

Build health + remaining blockers. The product cannot function without these.

### 4.1 Fix Build Health

**Problem:** 10 type errors in `@switchboard/api` from schema drift introduced
by SP4 (CRM outcome schemas changed `LeadData`, `pastPerformance` type,
`CanonicalSubmitRequest`). Test failures cascade from same root cause.

**Fix:**

- Align `meta-lead-intake-workflow.ts` types with updated `LeadData` schema
  (name: `string | undefined` → `string | null`, add `attribution` as optional)
- Fix `creative-job-submit-workflow.ts` `pastPerformance` type (`string | null`
  → `Record<string, unknown> | null`)
- Fix `governance.ts` — remove `deployment` from `CanonicalSubmitRequest` literal
- Add null checks in test assertions for `result.outputs`

**Exit criteria:** `pnpm typecheck` and `pnpm test` pass across all 18 packages.

### 4.2 B1: Self-Serve Signup

**Problem:** Signup exists but is gated behind `LAUNCH_MODE=beta`. Default shows
waitlist. No email verification.

**Design:**

- Add `LAUNCH_MODE=public` that opens registration without invite codes
- Add email verification flow: register → send verification email → click link →
  account activated. Unverified accounts cannot proceed past onboarding step 1.
- Email transport: Resend (or Nodemailer with SMTP) — add `EMAIL_FROM`,
  `RESEND_API_KEY` to env config
- Verification token: random UUID stored in `User` table with `emailVerifiedAt`
  timestamp. Token expires after 24 hours.
- Rate limit: 3 registration attempts per email per hour

**Scope exclusion:** Social login (Google/Facebook OAuth) is post-launch.

### 4.3 B2: Stripe Billing

**Problem:** No payment infrastructure. No trial. No monetization path.

**Design:**

- Stripe Checkout for subscription creation
- Three tiers matching pricing page: Starter ($49/mo), Pro ($149/mo), Scale
  ($399/mo) — prices stored in Stripe, not hardcoded
- 30-day free trial on all tiers (no card required to start, card required to
  continue)
- Trial status tracked on `Organization`: `trialEndsAt`, `subscriptionStatus`
  (`trialing` | `active` | `past_due` | `canceled`)
- Stripe webhook handler for `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`
- Dashboard billing page: current plan, usage, upgrade/downgrade, cancel,
  payment method management via Stripe Customer Portal
- Grace period: 7 days past due before feature restriction
- Feature gating: enforce tier limits (conversations/month, integrations) at
  API layer via middleware that reads `Organization.subscriptionStatus`

**Key files:**

- New: `apps/api/src/routes/billing.ts` (Stripe endpoints)
- New: `apps/api/src/services/stripe-service.ts` (Stripe SDK wrapper)
- New: `apps/dashboard/src/app/(auth)/settings/billing/page.tsx`
- Modified: `packages/db/prisma/schema.prisma` (Organization fields)
- Modified: `packages/schemas/src/organization.ts` (billing schemas)

### 4.4 B3/B4: Meta Ads OAuth Wiring

**Problem:** Backend OAuth flow exists (`apps/api/src/routes/facebook-oauth.ts`)
but dashboard never triggers it. Setup shows manual token paste fields.

**Design:**

- Dashboard "Connect Meta Ads" button triggers OAuth redirect to
  `GET /api/facebook-oauth/authorize` with required scopes
  (`ads_management`, `ads_read`, `pages_read_engagement`)
- Callback handler stores access token as encrypted connection credential
- After OAuth: fetch real ad accounts via Meta Marketing API
  (`GET /act_{ad_account_id}`) and present picker
- Store selected ad account ID + pixel ID on connection record
- Remove hardcoded placeholder ad accounts (G5 fixed as side effect)
- Connection test: verify token validity via `GET /me` on stored token

**Key files:**

- Modified: `apps/dashboard/src/components/settings/connections-list.tsx`
- Modified: `apps/dashboard/src/lib/service-field-configs.ts`
- New: `apps/dashboard/src/app/api/dashboard/connections/meta-ads/callback/route.ts`
- Modified: `apps/api/src/routes/facebook-oauth.ts` (ensure scopes + account picker)

### 4.5 B9: Google Calendar Self-Serve

**Problem:** Stub `CalendarProvider` returns empty slots. No dashboard flow to
connect Google Calendar. Bookings are DB-only.

**Design:**

- Google Calendar OAuth flow in onboarding module setup and settings
- Scopes: `calendar.events`, `calendar.readonly`
- Store refresh token as encrypted connection credential
- Replace `LocalCalendarProvider` dispatch: if `google_calendar` connection
  exists for org, use `GoogleCalendarAdapter`; otherwise fall back to local
  with clear "DB-only" indicator
- Calendar picker: after OAuth, list calendars, let user select which one
  receives bookings
- Health indicator: show "connected" / "DB-only" on dashboard, not "degraded"
  (fixes G23 as side effect)

**Key files:**

- New: `apps/api/src/routes/google-calendar-oauth.ts`
- New: `apps/dashboard/src/components/settings/calendar-connect.tsx`
- Modified: `packages/core/src/calendar/` (provider dispatch logic)
- Modified: `packages/db/prisma/schema.prisma` (connection type for google_calendar)

### Wave 1 Exit Criteria

- `pnpm typecheck` and `pnpm test` pass (all 18 packages green)
- A new user can: register with email → verify email → start 30-day trial →
  connect Meta Ads via OAuth → connect WhatsApp (existing) → connect Google
  Calendar via OAuth → complete onboarding → activate Alex → receive a lead →
  get a real Google Calendar booking
- Stripe webhook processes subscription lifecycle events correctly

---

## 5. Wave 2 — Credibility

Trust and reliability gaps. Without these, the system silently degrades or users
lose confidence.

### 5.1 G4: Privacy Policy + Terms of Service

- Static pages at `/privacy` and `/terms`
- Footer links on all public pages
- Checkbox on signup: "I agree to the Terms of Service and Privacy Policy"
- Content: standard SaaS terms (data processing, liability, cancellation).
  Legal review recommended but not blocking for beta-to-public transition.

### 5.2 G6: Meta Ads Token Refresh

- Meta long-lived tokens expire after 60 days
- Add `tokenExpiresAt` field to connection credentials
- Inngest cron job runs daily: find tokens expiring within 7 days, call
  Meta token refresh endpoint (`GET /oauth/access_token?grant_type=fb_exchange_token`)
- On refresh failure: mark connection as `needs_reauth`, show banner in
  dashboard, send email notification to owner
- On successful refresh: update token + expiry in credential store

### 5.3 G12: Escalation Email Fallback

- Current: escalation notifications go to Telegram only, silently no-op without config
- Add email as default escalation notification channel
- Use same email transport as signup verification (Resend/SMTP)
- Escalation email includes: reason, conversation summary, link to escalation
  inbox in dashboard
- Telegram remains as optional additional channel

### 5.4 G24: Campaign Attribution

- Meta Lead Ad webhook includes `ad_id` (already extracted)
- Add `campaign_id` extraction from webhook payload (available in `ad_group_id`
  field or via Marketing API lookup from `ad_id`)
- Populate `sourceCampaignId` on `ConversionRecord` at intake time
- ROI page campaign breakdown becomes functional

### 5.5 G25: Reconciliation Scheduling

- Register Inngest cron function: `0 2 * * *` (daily 2 AM)
- Calls `ReconciliationRunner.reconcile()` for each active organization
- Writes `ActivityLog` entry with reconciliation results
- Dashboard health indicator reflects last successful reconciliation

### 5.6 G27: Database Backup Automation

- Add `backup.sh` script: `pg_dump` with timestamped filename to configured
  backup directory (or S3 bucket via `aws s3 cp`)
- Cron: daily at 1 AM, retain 30 days
- Docker Compose: add backup service with volume mount
- Document restore procedure in `docs/OPERATIONS.md`

### 5.7 G28: Redis Password

- Setup script generates random password via `openssl rand -base64 32`
- Writes to `.env` as `REDIS_PASSWORD`
- Docker Compose Redis service uses `--requirepass`
- All Redis clients read password from env

### 5.8 G29: Postgres Image Fix

- Change `docker-compose.release.yml` from `postgres:16` to `pgvector/pgvector:pg16`
- Ensures pgvector extension is available for embedding queries

### 5.9 G23: Calendar Health Indicator

- Depends on B9 (Wave 1) shipping the real Calendar provider
- When Calendar connected: health shows "connected"
- When no Calendar connected: show "Not connected — bookings are saved but no
  calendar events created" instead of misleading "degraded"
- Small change in dashboard health card component

### Wave 2 Exit Criteria

- Privacy policy and terms pages live, linked from footer and signup
- Meta tokens auto-refresh; dashboard warns 7 days before expiry
- Escalation emails arrive without Telegram configured
- ROI page shows campaign-level breakdown
- Reconciliation runs daily
- Database backups run daily with documented restore
- Redis requires password; Postgres uses pgvector image

---

## 6. Wave 3 — Polish + UX Gaps

No stubs, no placeholders, no hardcoded fake data visible to users.

### Public Site

| #   | Item                    | Work                                                                                                                           |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| G1  | Social proof            | Add "trusted by X businesses" counter or testimonial section (can start with "Join our growing community" if no real data yet) |
| G2  | Pricing consistency     | Align homepage pricing mention with `/pricing` page tiers                                                                      |
| G3  | Trust score explanation | Rename to "Performance Score" in SMB-facing UI, add tooltip explaining what it measures                                        |
| G5  | Placeholder ad accounts | Removed by B3/B4 in Wave 1                                                                                                     |
| P1  | "Speed-to-Lead" label   | Rename to "Alex" in all customer-facing surfaces                                                                               |
| P2  | Footer tagline          | Replace with commercial tagline                                                                                                |
| P3  | Nav CTA inconsistency   | Unify to "Get Started" everywhere                                                                                              |
| P4  | "Most popular" badge    | Remove or replace with "Recommended"                                                                                           |
| P5  | Waitlist form           | Replace with signup redirect (waitlist no longer needed)                                                                       |

### Onboarding + Activation

| #   | Item                            | Work                                                                                                |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| G7  | Meta Ads connection test        | Add "Test Connection" button (like WhatsApp already has) that verifies token + fetches account name |
| G8  | Module setup wizard persistence | Wire wizard steps to roster API `config` field (identity persistence pattern from hardening)        |
| G10 | Launch animation                | Use real test lead flow or replace with simple "Alex is live" confirmation                          |

### Visibility + Trust

| #   | Item                             | Work                                                                                            |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| G14 | Agent decision reasoning         | Add "Why" expandable on activity feed items showing skill reasoning summary                     |
| G15 | Human-readable traces            | Format execution traces as timeline with plain-English step descriptions                        |
| G16 | Module traces page               | Wire to real trace data (execution log entries filtered by module)                              |
| G18 | Diagnostic error states          | Replace generic "Something went wrong" with specific messages + suggested actions               |
| G19 | Approval history "why"           | Show risk category + reasoning from policy engine on approval history entries                   |
| P9  | Currency hardcoding              | Add `currency` to `OrganizationConfig`, default to org's locale, display with Intl.NumberFormat |
| P10 | Data freshness on main dashboard | Add "Last updated" timestamp on stat cards                                                      |

### Operator Controls

| #   | Item                             | Work                                                                                    |
| --- | -------------------------------- | --------------------------------------------------------------------------------------- |
| G22 | Agent pause/disable toggle       | Add on/off toggle on dashboard home — pauses skill dispatch without full emergency halt |
| G26 | Manual revenue/booking recording | Add "Record manually" form on ROI page for offline bookings                             |

### Deferred (not in scope)

| #   | Item                              | Reason                                                                            |
| --- | --------------------------------- | --------------------------------------------------------------------------------- |
| G21 | Undo/correction for agent actions | Complex, low frequency. Escalation + override are the safety valves. Post-launch. |

### Wave 3 Exit Criteria

- No placeholder text, stub pages, or hardcoded fake data in any user-visible surface
- Error messages are specific and actionable
- Traces are human-readable
- Currency respects org locale
- Agent can be paused without emergency halt

---

## 7. Wave 4 — Ops Readiness

Cannot run a public product without operational visibility.

### 7.1 Health Check Endpoints

- `GET /health` on API (port 3000), chat (port 3001), dashboard (port 3002)
- Returns: `{ status: "ok" | "degraded", checks: { db, redis, ... }, uptime }`
- Used by Docker health checks and external monitoring

### 7.2 Error Alerting

- Integrate Sentry (or Betterstack/PagerDuty) for error tracking
- Critical errors (unhandled exceptions, governance failures, payment failures)
  trigger immediate notification (email or Slack/Telegram)
- Error grouping and deduplication
- Source maps for dashboard (Next.js Sentry plugin)

### 7.3 Runbook

- Create `docs/OPERATIONS.md` covering:
  - Common incidents: agent misbehavior, Meta API rate limit, DB connection
    exhaustion, Redis OOM, Stripe webhook replay
  - Diagnostic commands for each
  - Escalation paths
  - Rollback procedure

### 7.4 Log Aggregation

- Structured JSON logging across all services (replace any remaining
  `console.warn` with structured logger)
- Docker Compose log driver configuration for aggregation
- Recommend: Betterstack Logs, Axiom, or Loki for searchable log storage

### 7.5 Rate Limiting Review

- Audit nginx rate limits against expected traffic
- Add API-level rate limiting per organization (token bucket in Redis)
- Rate limit on auth endpoints: 5 attempts per minute per IP

### 7.6 Env + Config Cleanup

| #   | Item                            | Work                                                                  |
| --- | ------------------------------- | --------------------------------------------------------------------- |
| P6  | `FACEBOOK_REDIRECT_URI` default | Change `.env.example` to production URL pattern                       |
| P7  | nginx domain replacement        | Add setup script step that prompts for domain and writes nginx config |
| P8  | `LAUNCH_MODE` documentation     | Document in setup script and README                                   |

### Wave 4 Exit Criteria

- Health endpoints return meaningful status on all services
- Critical errors trigger alerts within 5 minutes
- Operations runbook covers top 5 incident types
- Logs are searchable
- Rate limits protect against abuse

---

## 8. Risk Register

| Risk                                                                           | Impact                        | Mitigation                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------- |
| Stripe integration complexity (webhook edge cases, subscription state machine) | Wave 1 takes longer           | Start with Checkout + portal, defer custom billing page to Wave 3                 |
| Google Calendar OAuth consent screen review (Google verification process)      | Blocks calendar for new users | Use "Testing" mode initially (100 user limit), apply for verification in parallel |
| Meta token refresh reliability (Meta API changes)                              | Silent degradation            | Aggressive monitoring + email alerts on refresh failure                           |
| Legal review of privacy policy / terms                                         | Blocks Wave 2                 | Use standard SaaS template, flag for review                                       |
| Sentry/monitoring vendor selection                                             | Delays Wave 4                 | Pick one fast (Sentry has free tier), don't over-evaluate                         |

---

## 9. Dependencies Between Waves

- Wave 2 depends on Wave 1's email transport (verification email reused for
  escalation email fallback and token refresh notifications)
- Wave 3's G7 (Meta Ads test) depends on Wave 1's B3 (OAuth wiring)
- Wave 3's G5 (placeholder accounts) is automatically fixed by Wave 1's B3
- Wave 4 is independent and could run in parallel with Wave 3

---

## 10. Success Metric

A stranger arrives at the homepage, signs up, connects Meta Ads + WhatsApp +
Google Calendar, activates Alex, and within one day of their first Meta Ad lead:

- Lead is auto-qualified via WhatsApp conversation
- Appointment is booked on their real Google Calendar
- Booking appears on their ROI dashboard with campaign attribution
- They receive an escalation email (not Telegram) when Alex needs help
- They can halt Alex, override a conversation, and resume — all from the dashboard

No founder intervention required at any step.
