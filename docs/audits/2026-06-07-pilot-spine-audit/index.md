# Pilot-Spine Live Walkthrough Audit

**Date:** 2026-06-07

**Spec:** [`docs/superpowers/specs/2026-06-07-pilot-spine-audit-design.md`](../../superpowers/specs/2026-06-07-pilot-spine-audit-design.md)
(Note: the spec currently lives on branch `docs/pilot-spine-audit-spec`, pending merge to `main`.)

**Method:** Architecture audit + Route-chain audit. Every finding follows the evidence
standard (exact file path, exact function/route/component, observed behavior, expected
behavior, customer/product impact, recommended fix, validation/test). Each route-chain
step is traced end-to-end: frontend → hook/client → dashboard proxy → backend route →
service/store → database/external provider. Status per step is one of
PASS / FAIL / STUB / NO-OP / MISSING.

---

## Verdict map

One row per journey step. `verdict` ∈ PASS / FAIL / STUB / NO-OP / MISSING / (blank = not yet run).
`artifact` links the evidence file under `evidence/`.

| step  | description | verdict | artifact |
| ----- | ----------- | ------- | -------- |
| J1-S1 |             |         |          |
| J1-S2 |             |         |          |
| J1-S3 |             |         |          |
| J1-S4 |             |         |          |
| J2-S1 |             |         |          |
| J2-S2 |             |         |          |
| J2-S3 |             |         |          |
| J2-S4 |             |         |          |
| J3-S1 |             |         |          |
| J3-S2 |             |         |          |
| J3-S3 |             |         |          |
| J3-S4 |             |         |          |
| J3-S5 |             |         |          |
| J3-S6 |             |         |          |
| J4-S1 |             |         |          |
| J4-S2 |             |         |          |
| J4-S3 |             |         |          |
| J5-S1 |             |         |          |
| J5-S2 |             |         |          |
| J5-S3 |             |         |          |
| J6-S1 |             |         |          |
| J6-S2 |             |         |          |
| J6-S3 |             |         |          |
| J7-S1 |             |         |          |
| J7-S2 |             |         |          |
| J7-S3 |             |         |          |
| J7-S4 |             |         |          |

---

## Flag inventory

Every flag/field on the pilot spine: who writes it, who reads it, its production default,
and whether the writer/reader pair is wired (verdict).

Verdict vocabulary: **LIVE** (producer writes, consumer enforces), **DORMANT** (consumer
exists, producer never populates or flag off at prod default), **ILLUSION** (UI/field
suggests control, nothing enforces it). For "prod default", where the `.env.example` value
and the code's behavior-when-unset differ, both are recorded.

Verified against `main` (worktree `audit/pilot-spine`) on 2026-06-07. "No writer" rows were
confirmed with two patterns (field name + Prisma write on the model) before recording DORMANT.

| flag / field                                                                                         | writer (file:line)                                                                                                                                                                           | reader (file:line)                                                                                                                                                                                     | prod default                                                                                                       | verdict                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OrganizationConfig.businessHours`                                                                   | **none in product** — only `packages/db/prisma/seed-marketplace.ts:613,634` (dev seed). Fresh org `provision-dashboard-user.ts:25` and signup `organizations.ts` create OrgConfig WITHOUT it | `apps/api/src/bootstrap/calendar-provider-factory.ts:63` (null ⇒ NoopCalendarProvider, "bookings disabled" :140)                                                                                       | unset (no writer)                                                                                                  | **DORMANT** (F-01, blocks-pilot)                                                                                                                                |
| `OrganizationConfig.subscriptionStatus` + `entitlementOverride`                                      | only Stripe webhook `apps/api/src/routes/billing.ts:223,231` (sets `trialing`/active). No signup/seed/override writer                                                                        | `packages/core/src/billing/entitlement.ts:14`; enforced `platform-ingress.ts:196` + `apps/api/src/middleware/billing-guard.ts:71`                                                                      | `subscriptionStatus="none"`, `entitlementOverride=false` (schema defaults); Stripe OFF (`STRIPE_SECRET_KEY` empty) | **DORMANT** (F-02, blocks-pilot) — fresh org `entitled:false` ⇒ every mutating submit/route 403s; no producer ever entitles it                                  |
| `INTERNAL_API_SECRET` (+ `CHAT_PUBLIC_URL`/`SWITCHBOARD_CHAT_URL`)                                   | operator env                                                                                                                                                                                 | `apps/api/src/lib/resolve-provision-status.ts:23` via `apps/api/src/routes/organizations.ts:364,505` (missing ⇒ `config_error`, not `active`)                                                          | `INTERNAL_API_SECRET` empty; chat URLs default to localhost                                                        | **DORMANT** (F-03, embarrasses-pilot) — channel never resolves `active` until set                                                                               |
| `NEXT_PUBLIC_REPORTS_LIVE`                                                                           | operator env                                                                                                                                                                                 | `apps/dashboard/src/lib/route-availability.ts:36` → `results-page.tsx:35`, `reports-page.tsx:29`, `fixture-mode-banner.tsx:15`                                                                         | `false` (`.env.example`)                                                                                           | **DORMANT** (F-04, embarrasses-pilot) — Results/reports render fixture mode + "demo data" banner at default                                                     |
| `NEXT_PUBLIC_LAUNCH_MODE`                                                                            | operator env                                                                                                                                                                                 | `apps/dashboard/src/app/api/auth/register/route.ts:14` (`\|\| "waitlist"`; OPEN_MODES = beta/public)                                                                                                   | `.env.example` = `public`; **code-when-unset = `waitlist` ⇒ 403 on signup**                                        | **DORMANT** (F-05, blocks-pilot if env not set) — divergent default; an unset prod env blocks all signup                                                        |
| `SLACK_BOT_TOKEN` + `SLACK_APPROVAL_CHANNEL`                                                         | operator env                                                                                                                                                                                 | `apps/api/src/bootstrap/approval-notifier.ts:23` (both required, else returns `undefined` = notifier off)                                                                                              | both empty (`.env.example`)                                                                                        | **DORMANT** (F-06, embarrasses-pilot) — parked-approval Slack notifications dark until both set                                                                 |
| `FOLLOWUP_ALLOW_MARKETING_TEMPLATE`                                                                  | operator env                                                                                                                                                                                 | `apps/api/src/bootstrap/contained-workflows.ts:299` → `proactive-eligibility.ts:83` (`marketing` category ⇒ `marketing_blocked`)                                                                       | empty ⇒ `false`                                                                                                    | **DORMANT** (F-07, decay) — follow-up cron runs but marketing-category re-engagement sends are skipped; utility templates still send                            |
| serviceId `"meta"` vs `"meta-ads"` (Results path)                                                    | credential resolver writes `"meta-ads"` (`prisma-credential-resolver.ts:20`)                                                                                                                 | dashboard `results-page.tsx:62` and API `dashboard-reports.ts:38` BOTH query `"meta-ads"`                                                                                                              | n/a                                                                                                                | **LIVE** (REFUTED) — pre-identified "API queries `meta`" is stale; resolver matches. Inline comment at `results-page.tsx:60` is outdated                        |
| `AgentDeployment.trustLevel` (col, default `observe`) + `spendApprovalThreshold` (col, default `50`) | columns set only by seeds (`seed-marketplace.ts`, `seed-*-deployment.ts`); fresh-org deployment `ensure-alex-listing.ts:43` leaves both at default                                           | live gate reads `governanceSettings.trustLevelOverride` / `.spendAutonomy` (JSON), NOT the columns — `governance-gate.ts:93`, `spend-approval-threshold.ts:47-52`, `prisma-deployment-resolver.ts:133` | columns at schema default; `governanceSettings={}` for fresh org; no product writer of the JSON keys               | **ILLUSION** (F-08, decay) — the autonomy columns are stored but never the enforcement axis; only seed/test fixtures populate the JSON keys that the gate reads |
| `NEXT_PUBLIC_CONTACTS_LIVE`                                                                          | operator env                                                                                                                                                                                 | `apps/dashboard/src/lib/route-availability.ts:30` (`isMercuryToolLive`)                                                                                                                                | `true` (`.env.example`)                                                                                            | **LIVE** (refuted as a gap) — default `true`; /contacts is live at prod default                                                                                 |
| `NEXT_PUBLIC_APPROVALS_LIVE` / `_AUTOMATIONS_LIVE` / `_ACTIVITY_LIVE`                                | operator env                                                                                                                                                                                 | `apps/dashboard/src/lib/route-availability.ts:31-34`                                                                                                                                                   | `true` (`.env.example`)                                                                                            | **LIVE** — live at prod default                                                                                                                                 |
| `NEXT_PUBLIC_GOOGLE_AUTH_CONFIGURED`                                                                 | operator env                                                                                                                                                                                 | `apps/dashboard/src/app/login/page.tsx:11` (gates "Sign in with Google" button)                                                                                                                        | empty ⇒ button hidden                                                                                              | **DORMANT** (cosmetic; not filed — credential login works without it)                                                                                           |
| `NEXT_PUBLIC_SMTP_CONFIGURED`                                                                        | operator env                                                                                                                                                                                 | `apps/dashboard/src/app/login/page.tsx:10` (gates magic-link UI)                                                                                                                                       | empty ⇒ magic link hidden                                                                                          | **DORMANT** (cosmetic; not filed — password login works)                                                                                                        |
| `RESEND_API_KEY`                                                                                     | operator env                                                                                                                                                                                 | `register/route.ts:50` (`autoVerify = !RESEND_API_KEY`); `calendar-provider-factory.ts` (booking confirm email)                                                                                        | empty                                                                                                              | **LIVE-by-fallback** — unset ⇒ signup auto-verifies + booking emails disabled (graceful); not a gap                                                             |
| `OPERATOR_ALERT_WEBHOOK_URL` (+`_SECRET`)                                                            | operator env                                                                                                                                                                                 | `apps/api/src/app.ts:428` (alerter off if unset)                                                                                                                                                       | empty                                                                                                              | **DORMANT** (decay; not filed — operator alerting dark until set; pilot can use Slack F-06 path)                                                                |

### Out-of-scope (flag-off; listed so nothing is silently omitted)

Mira/Riley-only kill-switches, all default OFF — not on the customer pilot spine. Recorded
for completeness; not filed as findings.

| flag                                    | prod default | scope                                                                   |
| --------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| `RILEY_OUTCOME_ATTRIBUTION_ENABLED`     | `false`      | Riley PR-3 outcome attribution                                          |
| `RILEY_PAUSE_SELF_EXECUTION_ENABLED`    | `false`      | Riley pause self-submission (cron kill-switch; also needs per-org flag) |
| `CREATIVE_ATTRIBUTION_ENABLED`          | `false`      | Mira per-creative attribution sweep                                     |
| `ALEX_MODEL_ROUTER_ENABLED`             | `false`      | Alex per-turn model tiering (eval baseline pending)                     |
| `MIRA_SELF_BRIEF_ENABLED`               | `false`      | Mira weekly self-brief loop                                             |
| `MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED` | `false`      | Mira→Riley handoff brief enrichment                                     |

### Seam note (not filed)

`ensureAlexListingForOrg` (creates the Alex `AgentDeployment`) is NOT called by the dashboard
self-serve signup path (`register/route.ts` → `provisionDashboardUser` → `seedOrgDayOneAgents`,
which only seeds `OrgAgentEnablement`). The Alex deployment is created lazily on the first
`GET /api/organizations/:orgId/config` read (`organizations.ts:83`), which the dashboard hits
early via `getOrgConfig` (`settings.ts:96`). Reachable, so not a hard blocker — but the spine
depends on an incidental config-read for deployment creation rather than an explicit signup step.

---

## Ranked findings

(From the flag/producer inventory pass. Steps J*-S* route-chain findings to follow.)

### Blocks pilot

- [F-01](findings/F-01-business-hours-no-producer.md) — `OrganizationConfig.businessHours` has no product writer; fresh orgs get NoopCalendarProvider (bookings disabled).
- [F-02](findings/F-02-fresh-org-entitlement-blocked.md) — fresh org is `entitled:false`; every mutating action 403s and no producer entitles it (Stripe off, no signup trial/override).
- [F-05](findings/F-05-launch-mode-divergent-default.md) — `NEXT_PUBLIC_LAUNCH_MODE` code-unset default is `waitlist` (403 signup) while `.env.example` says `public`; blocks signup if the prod env var is unset.

### Embarrasses pilot

- [F-03](findings/F-03-internal-api-secret-channel-config-error.md) — channel resolves `config_error` (not `active`) until `INTERNAL_API_SECRET` is set.
- [F-04](findings/F-04-reports-live-fixture-default.md) — `NEXT_PUBLIC_REPORTS_LIVE=false` at default; Results/reports render fixture mode + demo-data banner.
- [F-06](findings/F-06-slack-approval-notifications-dark.md) — parked-approval Slack notifications dark until `SLACK_BOT_TOKEN` + `SLACK_APPROVAL_CHANNEL` set.

### Cosmetic

_(none from this pass)_

### Decay

- [F-07](findings/F-07-followup-marketing-template-blocked.md) — `FOLLOWUP_ALLOW_MARKETING_TEMPLATE` empty default skips marketing-category re-engagement sends (intended posture; flag to flip post Meta approval).
- [F-08](findings/F-08-autonomy-columns-not-enforcement-axis.md) — `AgentDeployment.trustLevel`/`spendApprovalThreshold` columns are stored but the gate enforces from `governanceSettings` JSON; autonomy columns are an enforcement illusion.

---

## Deviations log

Record any deviation from the plan/spec made during execution, with rationale.

_(none yet)_
