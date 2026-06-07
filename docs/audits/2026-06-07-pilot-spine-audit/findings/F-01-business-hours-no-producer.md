# F-01: `OrganizationConfig.businessHours` has no product writer — fresh orgs get NoopCalendarProvider (bookings disabled)

- **Severity:** blocks-pilot
- **Journey/step:** inventory
- **Verdict:** DORMANT
- **Location:** `apps/api/src/bootstrap/calendar-provider-factory.ts:63,140` (reader); `apps/dashboard/src/lib/provision-dashboard-user.ts:25` + `apps/api/src/routes/organizations.ts` (fresh-org OrgConfig create, no businessHours) (verified against main on 2026-06-07)
- **Evidence:**
  - Reader gate: `calendar-provider-factory.ts:63` `select: { businessHours: true }`; line 66-72 null-guards it; if absent (and no Google creds) falls to Option 3 `NoopCalendarProvider` with log `"no calendar configured, bookings disabled"` (`:140`).
  - Two-pattern "no writer" confirmation:
    1. Field-name grep `businessHours` across `apps packages scripts` returns only reads, tests, the `google-calendar-factory.ts:42` default, and `seed-marketplace.ts:613,634`.
    2. Prisma-write grep `organizationConfig.(create|update|upsert)` enumerates every writer (`provision-dashboard-user.ts:25`, `organizations.ts:64,139`, `agents.ts:322,383`, `playbook.ts:63`, `billing.ts`, `inngest.ts:650`, `seed.ts:75`, `seed-marketplace.ts:605`); grepping each route file for `businessHours` returns "(no businessHours)" for all product routes. Only `seed-marketplace.ts` (a dev seed) sets it.

## What was exercised

Read the calendar provider factory end-to-end. Grepped for every `businessHours` occurrence and every `organizationConfig` write, then checked each writer for the field. Confirmed the fresh-org create blocks (`provision-dashboard-user.ts:25` and `organizations.ts` config upsert) omit `businessHours`.

## What happened vs expected

Expected: an onboarding/settings surface writes `businessHours` so the per-org `LocalCalendarProvider` can offer slots. Observed: no product code writes it. A freshly provisioned org (signup) therefore resolves `NoopCalendarProvider` and cannot book — the core medspa pilot loop (lead → booking) is dead unless Google Calendar global env creds happen to be set, or the org row is hand-seeded via the dev marketplace seed.

## Suggested fix scope

Add a business-hours writer to the onboarding/settings flow (write `OrganizationConfig.businessHours` via an authed route) so the LocalCalendarProvider engages for self-serve orgs; ship the producer in the same PR that exposes the UI, and add a test asserting a fresh org resolves Local (not Noop) once hours are saved.
