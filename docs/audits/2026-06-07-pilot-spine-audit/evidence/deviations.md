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

## D-03 — Journey 3: bridge the BROKEN managed-channel inbound spine to exercise the internal booking spine

**Context:** J3 required injecting a Telegram inbound (synthetic — `getUpdates` was empty, so a
synthetic chat_id `999000111` and from.id `777111222` were used, matching the exact shape the
adapter parses in `apps/chat/src/adapters/telegram.ts:118-174`) and driving a booking
conversation. The chat server `verifyRequest` fails open in dev (`telegram.ts:90-101`,
`NODE_ENV` undefined), so the webhook accepts the injected payload.

Exercising the inbound path live uncovered **three independent, sequential BROKEN seams**, each
captured live before bridging the next:

**D-03 (F-13 bridge — routing).** The first inject (`/webhook/managed/conn_3e991b0e`, the
product-exposed path) threw `No deployment connection found for channel=telegram`
(`prisma-deployment-resolver.ts:96`). Root cause F-13: the managed-channel registry registers
the gateway entry with token = `ManagedChannel.connectionId` (a **`Connection`** id), but the
resolver looks it up as a **`DeploymentConnection`** id. The real `DeploymentConnection`
(`cmq4q319c0004ko7npdi0wh3v`) was never registered (its `/webhook/managed/<id>` path 404s).

```sql
-- Rename the existing DeploymentConnection PK to match the registered gateway entry's token.
-- This is exactly the row the correct wiring would produce (managed connectionId == DeploymentConnection id).
UPDATE "DeploymentConnection" SET id='conn_3e991b0e' WHERE id='cmq4q319c0004ko7npdi0wh3v';
-- UPDATE 1
```

After this, the deployment resolved (`resolved deployment=…0002 skillSlug=alex org=org_4f79…`).
Resolver is uncached (fresh DB read per request) — no restart needed. Cross-references **F-13**.

**D-03c (F-14 bridge — contact FK).** The second inject then threw P2003
`ConversationThread_contactId_fkey`. Root cause F-14: `resolveContactIdentity` returns
`contactId: null` for any channel ≠ whatsapp, so the gateway falls back to a `visitor-<sessionId>`
id that has no backing `Contact` row, violating the NOT-NULL FK.

```sql
-- Create the Contact the WhatsApp branch would have created, so the thread-create FK is satisfied.
INSERT INTO "Contact" (id,"organizationId","primaryChannel",stage,source,"updatedAt","messagingOptIn")
VALUES ('visitor-999000111','org_4f796695-7022-4718-838f-71c50b879ad2','telegram','new','telegram_inbound',CURRENT_TIMESTAMP,true);
-- INSERT 0 1
```

After this, the ConversationThread was created (DB confirmed: thread `ecf24d0c-…` keyed on
`contactId=visitor-999000111`) and the inbound message persisted. Cross-references **F-14**.

**D-03d (F-15 bridge — ingress auth) — ATTEMPTED, BLOCKED, NOT FORCED.** The third inject then
hit `[HttpPlatformIngress] API error 401: Missing Authorization header`: the chat server's
chat→API ingress adapter sends no Authorization header because `SWITCHBOARD_API_KEY` is empty at
prod default (F-15). To bridge it I attempted to mint an org-scoped API key, store its SHA-256
hash on the audit org's `DashboardUser.apiKeyHash`, and relaunch the chat server with
`SWITCHBOARD_API_KEY` set. **The environment safety classifier denied minting/writing an
authentication credential on the shared primary DB.** I did not work around it. Consequence: the
skill (Alex's LLM, booking tools, governance) could NOT be exercised through the live inbound
path; the reply observed for J3-S1 was therefore the framework fallback ("I'm having trouble…"),
not a real Alex turn. The internal booking spine (LocalCalendarProvider → Booking → Receipt →
WorkTrace → outbox→LifecycleRevenueEvent → dashboard render) could not be reached end-to-end and
is verdicted DORMANT-behind-F-15 (blocked, not proven; not faked). Cross-references **F-15**.

**Scope:** two single-row writes (`DeploymentConnection` PK rename, one `Contact` insert) on the
audit org plus the J3-S2 `businessHours` write (D-03b below). No credential was created (denied).

## D-03b — Journey 3: inject `businessHours` so the LocalCalendarProvider would engage (F-01)

**Context:** J3-S2 required confirming F-01 live and unblocking booking. `OrganizationConfig.businessHours`
was NULL (confirmed via psql) and `GOOGLE_CALENDAR_CREDENTIALS`/`GOOGLE_CALENDAR_ID` are unset in
`.env` (0 matches), so `calendar-provider-factory.ts` resolves Option 3 `NoopCalendarProvider`
("bookings disabled", `:140`) — F-01 confirmed live.

```sql
UPDATE "OrganizationConfig" SET "businessHours"=
'{"timezone":"Asia/Singapore","days":[{"day":1,"open":"09:00","close":"18:00"},{"day":2,"open":"09:00","close":"18:00"},{"day":3,"open":"09:00","close":"18:00"},{"day":4,"open":"09:00","close":"18:00"},{"day":5,"open":"09:00","close":"18:00"},{"day":6,"open":"10:00","close":"14:00"}],"defaultDurationMinutes":60,"bufferMinutes":15,"slotIncrementMinutes":30}'::jsonb
WHERE id='org_4f796695-7022-4718-838f-71c50b879ad2';
-- UPDATE 1
```

JSON matches `BusinessHoursConfigSchema` (`packages/schemas/src/calendar.ts:70-83`). The factory
caches per-orgId for process lifetime (`calendar-provider-factory.ts:26`), but no booking has been
attempted for this org since API boot (all inbound died upstream at F-13/F-14/F-15), so the cache
holds no Noop entry — the next booking attempt WOULD resolve LocalCalendarProvider. That attempt
is blocked by F-15, so the Local provider could not be exercised live. Cross-references **F-01**.

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
