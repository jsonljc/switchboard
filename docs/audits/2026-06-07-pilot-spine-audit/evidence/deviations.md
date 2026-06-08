# Audit Deviations Log

Documents every departure from the "exercise the real product path at production
defaults, no manual DB writes" rule. Each deviation cross-references the DORMANT/BROKEN
finding it produced.

---

## D-01 — Journey 1: login could not be exercised through the live UI (auth BROKEN)

**Context:** J1-S3 required logging in through `http://localhost:3002/login` under the
audit's production posture (`next start`, `NODE_ENV=production`, auth ON) and capturing an
authed screenshot.

**What happened:** Every Auth.js (next-auth v5 beta.25) endpoint on :3002 returns
`UntrustedHost` (HTTP 500, body `"There was a problem with the server configuration"`).
Login is impossible. Root cause and the Vercel-vs-local distinction are recorded in
**finding F-09**.

**Attempted remediation (BLOCKED, intentionally not forced):** To prove the _positive_
case — that login + the post-login lazy `AgentDeployment` chain work once the host is
trusted (the state that holds on Vercel, where the platform sets the `VERCEL` env that
Auth.js auto-trusts) — I attempted to launch a **second, isolated** dashboard instance on
port 3012 with `AUTH_TRUST_HOST=true`, leaving the canonical audit stack on :3002
untouched. The environment's safety classifier denied both (a) killing/restarting the live
:3002 dashboard and (b) launching a new instance with an auth-affecting env var. I did not
work around the denial. The :3002 audit stack was never modified or restarted; it remained
healthy throughout (`/login` → 200, auth endpoints → UntrustedHost, reproducible).

**Consequence for evidence:** The authed screenshot for J1-S3 could not be captured. The
artifact `evidence/j1-home-authed.png` instead shows the **login page** (login blocked) —
which is the honest artifact for a BROKEN login under this posture. The post-login lazy
`AgentDeployment` creation chain (`GET /api/organizations/:orgId/config` →
`ensureAlexListingForOrg`) was therefore **not exercised end-to-end through the UI**; it is
verdicted from source (the route is wired and idempotent) + the fact that it is
**unreachable by a self-serve customer while login is BROKEN**. See F-09.

---

## D-02 — Journey 2: entitle the audit org to proceed past the F-02 402 (channel connect)

**Context:** J2-S1 connected Telegram through the product (Playwright login as
`audit-pilot@example.com` → `POST /api/dashboard/organizations/provision`, the exact route
`useProvision()` calls). The fresh org is unentitled (F-02).

**What happened (F-02 reproduced live, captured first):** the upstream API returned **HTTP 402
"Active subscription required"** for `POST /api/organizations/org_4f796695-7022-4718-838f-71c50b879ad2/provision`
(API log; the dashboard proxy re-coded it to 500 — see F-12). `POST /provision` is a mutating,
non-allowlisted route, so `billing-guard.ts:74` 402s it after reading
`OrganizationConfig.subscriptionStatus`/`entitlementOverride` — exactly the F-02 resolver path.
Artifact: `evidence/j2-connect-response.json` (pre-D-02 block).

**Deviation applied (exact SQL):**

```sql
UPDATE "OrganizationConfig" SET "entitlementOverride"=true WHERE id='org_4f796695-7022-4718-838f-71c50b879ad2';
-- UPDATE 1
```

Before: `subscriptionStatus=none`, `entitlementOverride=f`. After: `entitlementOverride=t`.
The billing entitlement resolver is uncached (`apps/api/src/services/billing-entitlement-resolver.ts`
has no cache/TTL — fresh DB read per request), so no restart was needed.

**Justification & cross-reference:** this is the documented unblock for **F-02** (blocks-pilot).
It mirrors what a Stripe `trialing`/`active` webhook or a pilot-provisioning override would do in
production; F-02 stands as recorded (no product producer entitles a fresh org at prod defaults).
After the override, the same connect call returned **HTTP 200** with `status:"active"`, letting
J2-S2/S3 proceed.

**Scope:** single-column UPDATE on the audit org's `OrganizationConfig`. No other rows touched.
The `ManagedChannel`/`Connection`/`AgentDeployment` rows in J2 were created **solely** by the live
product provision route, not by hand.

---

## No manual DB writes were performed (Journey 1)

All DB access in Journey 1 was **read-only** (`SELECT` via psql) to inspect the rows
created by the real signup route. The fresh org
(`org_4f796695-7022-4718-838f-71c50b879ad2`) and all its child rows were created **solely**
by the live `POST /api/auth/register` product route. No row was hand-inserted, updated, or
seeded. The absence of an `AgentDeployment` row is therefore a true observation of the
fresh-org state, not an artifact of audit setup.

## D-01 update: deviation APPLIED (2026-06-07, controller)

After F-09 was confirmed at library level (spec review), `AUTH_TRUST_HOST=true` was added to
`apps/dashboard/.env.local` in the audit worktree and the dashboard was restarted.
Verification: `GET /api/auth/csrf` now returns 200 (was 500 UntrustedHost).

**Justification:** this is the exact local equivalent of the `VERCEL=1` env Vercel injects
(`@auth/core/lib/utils/env.js:40-44` treats them identically), so journeys J2+ still run at
honest production posture for a Vercel-deployed pilot. F-09 stands as recorded: non-Vercel
production runtimes break without an explicit `trustHost`/`AUTH_TRUST_HOST`.
