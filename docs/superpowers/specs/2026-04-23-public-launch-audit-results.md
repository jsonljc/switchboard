# Switchboard Public Self-Serve Launch Audit Results

> Audit conducted 2026-04-23 against the `feat/revenue-control-center` branch.
> Governing spec: `docs/superpowers/specs/2026-04-23-public-launch-audit-design.md`

---

## 1. Executive Launch Verdict

**Not Ready For Full Public Launch**

Switchboard is not ready for broad self-serve public launch. Four critical
journey steps are rated Fail (Signup, Integrations, Activation, and effectively
Pricing/Trial). The product cannot be used by an SMB owner without founder
intervention at every stage from account creation through funnel activation.

The autonomous operation engine, governance layer, and visibility surfaces are
substantially built and represent real capability — but they are unreachable by
a self-serve user because the entry funnel is broken.

---

## 2. Journey Step Summary

| Step                          | Rating             | Key Blocker                                                                                                                                                 |
| ----------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Production Environment** | Pass with friction | Deployment path exists. First user requires CLI bootstrap with secret.                                                                                      |
| **1. Discovery**              | Pass with friction | Homepage is polished but never mentions Meta Ads. Phantom agents on How It Works page.                                                                      |
| **2. Pricing + Trial**        | Fail               | No 30-day trial exists. No payment/billing integration. All CTAs lead to waitlist.                                                                          |
| **3. Signup + Onboarding**    | Fail               | No self-serve signup. Account creation requires founder-run CLI command.                                                                                    |
| **4. Meta Ads + WhatsApp**    | Fail               | Meta Ads OAuth stubbed in dashboard. WhatsApp requires raw credential paste.                                                                                |
| **5. Activation**             | Fail               | Missing `api-client.ts` crashes all proxy routes. Go-live creates wrong data model records.                                                                 |
| **6. Autonomous Operation**   | Pass with friction | Skill runtime and governance are strong. CalendarProvider has no Google Calendar self-serve setup. Escalation notifications silent without Telegram config. |
| **7. Visibility + Trust**     | Pass with friction | Dashboard and ROI page are real. No agent decision reasoning shown. Traces are raw JSON. No conversation browser.                                           |
| **8. Operator Intervention**  | Pass with friction | Approve/reject works. No emergency halt button. No escalation inbox UI. No conversation override UI.                                                        |
| **9. Proof of Value**         | Pass with friction | Funnel metrics and ROI page are real. Bookings are DB-only (no calendar events). Empty dashboard on trial start.                                            |

**Steps rated Fail: 4 of 10** (Steps 2, 3, 4, 5)
**Steps rated Pass with friction: 6 of 10** (Steps 0, 1, 6, 7, 8, 9)
**Steps rated Pass: 0 of 10**

---

## 3. Blocker List (ordered by launch impact)

### B1. No self-serve signup flow

- **Step:** 3 (Signup + Onboarding)
- **Subsystem:** Authentication
- **Impact:** The entire journey dies here. No user can create an account.
  The only path is `POST /api/setup/bootstrap` with `INTERNAL_SETUP_SECRET`,
  which is CLI-only, requires shell access, and works only when zero users
  exist. The login page's "Don't have an account?" link loops to the homepage
  waitlist.
- **Manual rescue required:** Yes
- **Manual setup debt:** Yes

### B2. No payment/billing infrastructure

- **Step:** 2 (Pricing + Trial)
- **Subsystem:** Pricing/Trial surfaces
- **Impact:** Zero Stripe or payment integration exists. The 30-day trial
  concept does not exist in the codebase — the Free tier says "forever," paid
  tiers say "Join waitlist." Pricing tiers are presentation-only with no
  enforcement. A self-serve trial cannot start.
- **Manual rescue required:** Yes
- **Manual setup debt:** Yes

### B3. Missing `api-client.ts` — all dashboard server routes broken

- **Step:** 5 (Activation)
- **Subsystem:** Dashboard / API platform
- **Impact:** `apps/dashboard/src/lib/get-api-client.ts` imports
  `SwitchboardClient` from `./api-client`, but no such file exists. Every
  server-side proxy route (go-live, channel provisioning, and others) will crash
  with an import error at runtime.
- **Manual rescue required:** Yes
- **Manual setup debt:** Yes

### B4. Meta Ads OAuth not wired in dashboard

- **Step:** 4 (Meta Ads + WhatsApp)
- **Subsystem:** Integration setup
- **Impact:** The backend OAuth flow is complete
  (`apps/api/src/routes/facebook-oauth.ts`), but the dashboard setup wizard
  shows a placeholder: "Facebook OAuth flow will be initiated here." The ad
  account selector shows hardcoded fake accounts. A user cannot connect Meta
  Ads from the product.
- **Manual rescue required:** Yes
- **Manual setup debt:** Yes

### B5. WhatsApp requires raw credential paste with no guidance

- **Step:** 4 (Meta Ads + WhatsApp)
- **Subsystem:** Integration setup
- **Impact:** WhatsApp connection asks for "Phone number" and "API key" in bare
  text fields. No explanation of what "API key" means (Cloud API token? System
  user token?). No embedded WABA provisioning, no OAuth, no test-connection
  button. An SMB owner cannot complete this without developer help.
- **Manual rescue required:** Yes
- **Manual setup debt:** Yes

### B6. Go-live creates wrong data model records

- **Step:** 5 (Activation)
- **Subsystem:** API platform / Chat runtime
- **Impact:** The go-live endpoint creates `ManagedChannel` records and sets
  `OrgConfig.provisioningStatus = "active"`. But the chat gateway resolves
  incoming messages via `DeploymentConnection` → `AgentDeployment`, which are
  never created during onboarding. Even if go-live succeeds, no messages are
  routable.
- **Manual rescue required:** Yes
- **Manual setup debt:** Yes

### B7. No emergency halt button in dashboard

- **Step:** 8 (Operator Intervention)
- **Subsystem:** Dashboard / Governance
- **Impact:** The backend supports `POST /api/governance/emergency-halt` to
  lock governance and pause campaigns, but no dashboard button exists. If the
  agent misbehaves or an ad campaign runs away, the owner cannot stop it
  without making a raw API call.
- **Manual rescue required:** Yes
- **Manual setup debt:** No

### B8. No escalation inbox UI

- **Step:** 8 (Operator Intervention)
- **Subsystem:** Dashboard
- **Impact:** Backend routes, proxy routes, and React hooks for escalation
  list/detail/reply all exist and work. But no page renders them. When the
  agent escalates a conversation, the owner has no way to see or respond.
  Escalations are invisible.
- **Manual rescue required:** Yes
- **Manual setup debt:** No

### B9. CalendarProvider has no self-serve Google Calendar setup

- **Step:** 6 (Autonomous Operation) / 9 (Proof of Value)
- **Subsystem:** Calendar integration
- **Impact:** `LocalCalendarProvider` persists bookings to DB only — no real
  calendar events. `GoogleCalendarAdapter` exists but requires service account
  credentials as env vars. No dashboard flow for the owner to connect their
  Google Calendar. The core value promise ("booked appointments") produces
  database records, not real calendar invites.
- **Manual rescue required:** Yes
- **Manual setup debt:** Yes

### B10. Homepage never mentions Meta Ads

- **Step:** 1 (Discovery)
- **Subsystem:** Public website
- **Impact:** The stated day-one wedge is Meta Ads → WhatsApp lead handling.
  The homepage mentions "WhatsApp, Telegram, or your website" but never
  explains the Meta Lead Ads integration. An SMB running Meta Ads will not
  understand this is for their ad leads.
- **Manual rescue required:** Yes
- **Manual setup debt:** No

### B11. "How It Works" page shows phantom agents

- **Step:** 1 (Discovery)
- **Subsystem:** Public website
- **Impact:** Lists "Sales Closer" and "Nurture Specialist" alongside the real
  "Speed-to-Lead" agent. These don't exist. Clicking "Browse agents" leads to
  a catalog exposing the gap.
- **Manual rescue required:** Yes
- **Manual setup debt:** No

### B12. All-zero dashboard on trial start

- **Step:** 9 (Proof of Value)
- **Subsystem:** Visibility / Reporting
- **Impact:** No seed or demo data for conversion records, bookings, or
  revenue. A new trial user sees "0 Bookings today," "$0 Revenue (7d)," and
  an empty funnel until real leads flow — which requires the Meta Ads
  integration that isn't wired.
- **Manual rescue required:** Yes
- **Manual setup debt:** Yes

---

## 4. Major-Gap List (keeps launch in beta/cohort mode)

| #   | Gap                                                                  | Step | Manual Rescue | Manual Setup Debt |
| --- | -------------------------------------------------------------------- | ---- | :-----------: | :---------------: |
| G1  | Zero real social proof on public site                                | 1    |      Yes      |        No         |
| G2  | Pricing page contradicts homepage pricing (1 tier vs 4 tiers)        | 1, 2 |      Yes      |        No         |
| G3  | Trust score concept unexplained for SMBs                             | 1, 2 |      No       |        No         |
| G4  | No privacy policy or terms of service                                | 1    |      No       |        No         |
| G5  | Hardcoded placeholder ad accounts in setup wizard                    | 4    |      No       |        No         |
| G6  | No Meta Ads token refresh — silently expires after 60 days           | 4    |      Yes      |        Yes        |
| G7  | No connection test/verify mechanism in onboarding                    | 4    |      Yes      |        No         |
| G8  | Module setup wizards are stub UI with no persistence                 | 5    |      No       |        Yes        |
| G9  | Go-live readiness check always shows "Playbook complete" (hardcoded) | 5    |      No       |        No         |
| G10 | Launch animation is cosmetic with hardcoded fake test lead           | 5    |      No       |        No         |
| G11 | Google Calendar connect step is a placeholder                        | 5    |      Yes      |        Yes        |
| G12 | Escalation notifications degrade silently to no-op without Telegram  | 6    |      Yes      |        Yes        |
| G13 | Business facts required but no validation at onboarding              | 6    |      No       |        Yes        |
| G14 | No agent decision reasoning visible to owner                         | 7    |      Yes      |        No         |
| G15 | Execution traces show raw JSON (developer-facing, not owner-facing)  | 7    |      Yes      |        No         |
| G16 | Module traces page is a stub                                         | 7    |      No       |        No         |
| G17 | No conversation browser in owner navigation                          | 7    |      Yes      |        No         |
| G18 | Error states are generic and non-diagnostic                          | 7    |      Yes      |        No         |
| G19 | Approval history shows what but not why                              | 7    |      No       |        No         |
| G20 | No conversation override UI (backend exists)                         | 8    |      Yes      |        No         |
| G21 | No undo or correction capability for agent actions                   | 8    |      Yes      |        No         |
| G22 | No agent pause/disable toggle in dashboard                           | 8    |      Yes      |        No         |
| G23 | Permanent "degraded" health indicator from LocalCalendarProvider     | 9    |      No       |        No         |
| G24 | sourceCampaignId never populated — campaign ROI breakdown empty      | 9    |      No       |        Yes        |
| G25 | Reconciliation runner never auto-scheduled                           | 9    |      Yes      |        Yes        |
| G26 | No manual revenue/booking recording from dashboard                   | 9    |      Yes      |        No         |
| G27 | No database backup automation                                        | 0    |      No       |        Yes        |
| G28 | Redis password not generated by setup script                         | 0    |      No       |        Yes        |
| G29 | Release pipeline uses wrong Postgres image (no pgvector)             | 0    |      No       |        No         |

---

## 5. Polish List (post-launch cleanup)

| #   | Item                                                                | Step |
| --- | ------------------------------------------------------------------- | ---- |
| P1  | "Speed-to-Lead" label in conversation demo header (internal naming) | 1    |
| P2  | Footer tagline is system-philosophical, not commercial              | 1    |
| P3  | Nav CTA says "Get early access" but pricing CTA says "Get started"  | 1    |
| P4  | "Most popular" badge on Pro tier is unverifiable                    | 2    |
| P5  | Waitlist form collects only email (no business name or use case)    | 2    |
| P6  | `FACEBOOK_REDIRECT_URI` defaults to localhost in `.env.example`     | 0    |
| P7  | nginx `DOMAIN` placeholder requires manual sed replacement          | 0    |
| P8  | `NEXT_PUBLIC_LAUNCH_MODE=waitlist` default not documented in setup  | 0    |
| P9  | Revenue currency hardcoded to SGD                                   | 9    |
| P10 | No data freshness indicator on main dashboard (only on ROI page)    | 7    |

---

## 6. Recommended Launch Mode

**Founder-led cohort**

The product cannot support broad self-serve launch. The entry funnel (signup →
integration → activation) is fundamentally broken for unassisted users.

However, the downstream engine is real:

- Autonomous skill runtime with multi-layer governance
- Working approval flow with binding hashes
- Real CRM tools, booking persistence, attribution chain
- Dense owner dashboard with funnel metrics and ROI breakdown
- Documented deployment path with Docker, migrations, and TLS

A founder-led cohort is viable if the founder:

1. Creates accounts via bootstrap CLI
2. Pre-configures WhatsApp credentials and Meta Ads connection
3. Sets up Google Calendar service account or accepts DB-only bookings
4. Configures Telegram for escalation notifications
5. Seeds business facts for each org
6. Monitors for issues directly (no emergency halt or escalation UI)

This is sustainable for 5–10 customers. Beyond that, the manual burden
becomes untenable.

---

## 7. Strongest Evidence Behind the Verdict

There is no self-serve signup flow. The `GET /get-started` page is a waitlist
form that collects an email and says "We'll reach out when access opens." The
login page's "Don't have an account?" link goes to the homepage. The only
account creation path is `POST /api/setup/bootstrap` with
`INTERNAL_SETUP_SECRET`, which requires shell access and works only when zero
users exist. This single fact — that no SMB owner can create an account without
founder intervention — is sufficient to fail self-serve launch readiness. Every
other finding reinforces this conclusion but is not required for it.

---

## 8. Manual Debt Map

| Critical Path Point      | Current Manual Dependency                                                          | What It Substitutes For                                     | User-Visible Impact                               | Step | Self-Serve Replacement Needed                          | Severity  |
| ------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- | ---- | ------------------------------------------------------ | --------- |
| Account creation         | CLI `curl` to bootstrap endpoint with `INTERNAL_SETUP_SECRET`                      | Self-serve signup with email/password or OAuth              | User cannot access the product at all             | 3    | Public registration page with email verification       | Blocker   |
| Payment / trial start    | No billing system exists                                                           | Stripe integration with trial period                        | User cannot start a trial or pay                  | 2    | Stripe Checkout + subscription management              | Blocker   |
| Meta Ads connection      | Founder configures `FACEBOOK_APP_ID`/`SECRET` env vars; OAuth UI is stubbed        | Dashboard OAuth flow triggering backend authorize endpoint  | User cannot connect ad account                    | 4    | Wire existing backend OAuth to dashboard button        | Blocker   |
| WhatsApp connection      | User must obtain Cloud API token externally and paste raw credentials              | Embedded WhatsApp Business signup or guided credential flow | User confused by "API key" field, likely abandons | 4    | WhatsApp Embedded Signup or step-by-step guide         | Blocker   |
| Funnel activation        | Founder must manually create `AgentDeployment` + `DeploymentConnection` DB records | Go-live endpoint creating correct deployment records        | Go-live appears to succeed but no messages route  | 5    | Fix go-live to create deployment + connection records  | Blocker   |
| Google Calendar          | Founder provisions service account credentials as env vars                         | Dashboard OAuth flow for Google Calendar                    | Bookings are DB-only; no calendar invites sent    | 6, 9 | Google Calendar OAuth in module setup wizard           | Blocker   |
| Escalation notifications | Founder configures `TELEGRAM_BOT_TOKEN` + `ESCALATION_CHAT_ID`                     | Dashboard notification preferences or email fallback        | Agent escalations go unnoticed                    | 6    | Email-based escalation notification as default         | Major gap |
| Business facts           | Founder seeds `BusinessFacts` store per org via DB/API                             | Onboarding step that collects business details              | Skill executor throws `ContextResolutionError`    | 6    | Onboarding wizard step to capture business facts       | Major gap |
| Emergency halt           | `POST /api/governance/emergency-halt` via curl                                     | Dashboard "Emergency Stop" button                           | Owner cannot stop runaway agent behavior          | 8    | Big red button on dashboard home                       | Blocker   |
| Escalation inbox         | Backend exists, no UI renders it                                                   | Dashboard page listing escalations with reply form          | Owner never sees agent escalation requests        | 8    | `/escalations` page wired to existing hooks            | Blocker   |
| Reconciliation           | Runner exists but never auto-invoked                                               | Cron job running `ReconciliationRunner` on schedule         | ROI health indicator always shows "stale" warning | 9    | Scheduled cron or Inngest job                          | Major gap |
| Demo/seed data           | No conversion, booking, or revenue seed data                                       | Onboarding demo data or sandbox mode                        | Owner sees all-zero dashboard on trial start      | 9    | Seed data generation during onboarding or sandbox mode | Major gap |

---

## 9. Time-to-Value Estimate

**Best-case time-to-value:** Cannot be estimated — the critical path is
currently blocked. A user cannot create an account, so time-to-first-booking
is undefined.

**Realistic current time-to-value (founder-assisted):**

| Phase                                           | Estimated Time | Blocker?                |
| ----------------------------------------------- | -------------- | ----------------------- |
| Founder creates account via CLI                 | 5 minutes      | Yes (founder-dependent) |
| User completes onboarding wizard (steps 1-3)    | 15-20 minutes  | No                      |
| Founder configures WhatsApp credentials         | 30-60 minutes  | Yes (founder-dependent) |
| Founder configures Meta Ads OAuth               | 15-30 minutes  | Yes (founder-dependent) |
| Founder sets up Google Calendar service account | 30-60 minutes  | Yes (founder-dependent) |
| First real lead arrives via Meta Ads            | Hours to days  | Depends on ad campaign  |
| Alex processes lead and books appointment       | 2-5 minutes    | No (autonomous)         |
| Owner sees booking on dashboard                 | Immediate      | No                      |

**Where the clock stalls:**

1. Account creation (founder must run CLI command)
2. WhatsApp credential provisioning (user or founder must navigate Meta's
   developer portal)
3. Meta Ads OAuth (founder must configure env vars, then wire is stubbed)
4. Google Calendar setup (founder must provision service account)
5. Waiting for first real lead (depends on external ad campaign)

**Which stalls are caused by blockers vs. manual dependencies:**

- Stalls 1-4 are all manual dependencies (founder intervention required)
- Stall 5 is inherent to the product model (not a product defect)

**Is current time-to-value acceptable for self-serve SMB trial?**
No. Under the most optimistic founder-assisted scenario, time from signup
intent to first booked appointment is measured in hours to days, with at least
4 founder-dependent handoffs. An unassisted SMB owner cannot reach first value
at all. For a 30-day trial to be credible, an SMB owner should reach first
booked appointment within the first day — ideally within the first hour of
completing onboarding. The current product requires the founder to be available,
technically capable, and willing to configure infrastructure per customer.

---

## Appendix: Positive Findings

The audit is designed to identify gaps, but the following capabilities are
genuinely strong and represent real platform value once the entry funnel is
unblocked:

1. **Skill runtime is production-grade** — Multi-turn tool-calling executor
   with budget enforcement (6 turns, 64K tokens, 30s), circuit breaker
   (5 failures/hour), blast radius limiter (50 writes/hour), and full
   governance policy matrix with trust-level-gated approval requirements.

2. **Alex skill is coherent and well-bounded** — 243-line skill definition
   with 4-phase funnel, 3 operating buckets, explicit slot selection rules,
   and 6 enumerated escalation triggers. Governance injector mandates no
   human impersonation, no financial promises, no fabricated data.

3. **Booking failure handling is robust** — Atomic failure handler marks
   booking failed, creates escalation record, emits outbox event, and returns
   safe customer-facing message. Duplicate booking guard catches Prisma unique
   constraint violations.

4. **Deployment infrastructure is solid** — Multi-stage Dockerfile, production
   Docker Compose with health checks, nginx with TLS/rate limiting/security
   headers, automated migration init container, interactive setup script,
   CI with 8 parallel jobs, tag-triggered release pipeline to GHCR.

5. **Owner dashboard is dense and real** — 6 stat cards, pipeline funnel
   strip, booking preview, revenue summary, activity feed, module status
   cards, recommendation bar, first-run banner. All backed by real Prisma
   queries, not mocked data.

6. **ROI page with data health** — Funnel bars, metric cards, campaign/channel
   breakdown, reconciliation-based health indicator with drift percentages and
   staleness warnings.

7. **Approval system with integrity** — Binding hash verification prevents
   tampering. Risk category labeling. Expiry countdown. Inline approve/reject
   on dashboard home and dedicated `/decide` page with history.

8. **Attribution chain exists end-to-end** — Meta Lead webhook → `ad_id`
   extraction → conversion record with `sourceAdId` → ROI breakdown by ad.
   Campaign-level rollup is the gap, not the chain itself.
