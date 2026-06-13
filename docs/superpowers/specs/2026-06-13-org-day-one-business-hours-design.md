# Spec: seed default business hours at org provisioning (pilot-spine F-01)

- Date: 2026-06-13
- Branch: `fix/org-day-one-provisioning`
- Blocker: pilot-spine audit F-01 (`docs/audits/2026-06-07-pilot-spine-audit/findings/F-01-business-hours-no-producer.md`)
- Status: design approved (autonomous; rationale recorded here in lieu of a check-in)

## Problem

A freshly provisioned org has `OrganizationConfig.businessHours = null`. The calendar provider
factory (`apps/api/src/bootstrap/calendar-provider-factory.ts`) resolves a provider in three tiers:

1. Google Calendar, only if `GOOGLE_CALENDAR_CREDENTIALS` + `GOOGLE_CALENDAR_ID` env are set.
2. `LocalCalendarProvider`, only if `businessHours` is a non-null, non-array object.
3. `NoopCalendarProvider` (bookings disabled) otherwise.

At production defaults the Google env pair is empty, and no product code writes `businessHours`
(verified on `origin/main`: every `organizationConfig.create|upsert` writer omits it; only the dev
seeds set it). So every self-serve org falls to tier 3 and the core medspa pilot loop
(lead -> booking) is dead. This is the F-01 blocks-pilot finding, re-verified still-open on
`origin/main` (4aba0760).

A second, subtler fact: the factory casts the stored value to `BusinessHoursConfig` WITHOUT
validating it (`calendar-provider-factory.ts:72`). Any non-null object takes the Local branch, then
the slot generator can break at runtime on a malformed shape. So the producer must write a value
that satisfies `BusinessHoursConfigSchema`, not merely "some object".

## Goal

A freshly provisioned org resolves `LocalCalendarProvider` (not Noop) out of the box, with a
schema-valid default `businessHours`, so the booking loop works with zero operator action and zero
external credentials. The operator can refine hours later (follow-up; see Out of scope).

## Approach (chosen)

Seed a schema-valid default `businessHours` into the org config at every creation site, sourced from
a single shared canonical constant.

1. Promote the existing default to a shared, exported constant. `DEFAULT_BUSINESS_HOURS` already
   exists, privately, in `apps/api/src/bootstrap/google-calendar-factory.ts:9` (Asia/Singapore,
   Mon-Fri 09:00-18:00, 30-min duration, 15-min buffer, 30-min slots). Move it to
   `packages/schemas/src/calendar.ts`, exported next to `BusinessHoursConfigSchema`. Schemas is
   Layer 1 (importable by both `apps/dashboard` and `apps/api`); the canonical instance belongs with
   its contract. Repoint `google-calendar-factory.ts` at the import (behavior identical).
2. Set `businessHours: DEFAULT_BUSINESS_HOURS` in both org-config CREATE sites:
   - `apps/dashboard/src/lib/provision-dashboard-user.ts` (self-serve signup, the primary path).
   - `apps/api/src/routes/organizations.ts` GET `/config` lazy upsert `create` branch (the fallback
     for API-first orgs).
3. Pin the producer -> consumer seam: a test asserting
   `BusinessHoursConfigSchema.safeParse(DEFAULT_BUSINESS_HOURS).success` is true (the seeded value
   satisfies the contract the slot generator and `LocalCalendarProvider` consume), plus a
   calendar-provider-factory test asserting an org whose config holds the REAL default resolves
   `LocalCalendarProvider`, not Noop.

### Why this over the alternatives

- **Operator settings route + dashboard UI (deferred).** Most accurate hours, but it is a larger
  surface (authed route + UI + per-field validation, since the consumer does not validate), and the
  booking loop stays dead until the operator acts, so it does not unblock the pilot out of the box.
  The minimal producer-population that resolves the blocker is the provisioning seed. Operator-edit
  is a clean follow-up that can carry proper validation; out of scope here.
- **Backfill migration for existing orgs + create-site seed (rejected for this PR).** Would cover
  pre-existing null-hours orgs too, but a data migration needs a running Postgres (down locally),
  risks clobbering any org with deliberately-null or custom hours, and widens blast radius. The
  pilot target is FRESH self-serve orgs, which the create-site seed fully covers. No backfill here.

## Idempotency and safety

- `businessHours` is written only in the `create` path at each site, never in an `update`.
  `provision-dashboard-user` create runs once per signup inside a transaction. The
  `organizations.ts` GET `/config` upsert uses `update: {}`, so re-running the hot config route never
  re-writes or clobbers a later operator-customized value. Provisioning re-runs are safe.
- No schema migration: `businessHours` is already `Json?` (`schema.prisma:437`).
- No `Date.now()` / elapsed / threshold / numeric comparison is introduced, so the clock-injection
  and `Number.isFinite` guidance does not apply to this slice (recorded so a reviewer need not hunt
  for it).

## Out of scope (deliberate)

- Operator-editable business hours via a settings route/UI (follow-up; would add `businessHours` to
  the PUT `/config` allowlist WITH validation).
- Backfilling existing orgs that currently have `businessHours = null`.
- F-02 (entitlement) and F-16 (per-org governance provisioning); F-16 is already substantially
  addressed on `origin/main` (signup now calls `provisionOrgAgentDeployments` + creates an owner
  `IdentitySpec`).

## Test plan (TDD)

All driven from the REAL default constant, not hand-set fixtures:

1. `packages/schemas/src/__tests__/calendar.test.ts`: `BusinessHoursConfigSchema.safeParse(
DEFAULT_BUSINESS_HOURS)` succeeds (the seam pin).
2. `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`: an org config holding
   `DEFAULT_BUSINESS_HOURS`, no Google env, resolves `LocalCalendarProvider` (not Noop).
3. `apps/api/src/__tests__/api-organizations.test.ts`: GET `/config` auto-create path writes
   `businessHours: DEFAULT_BUSINESS_HOURS`.
4. `apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts` (new): the signup transaction
   creates the org config with `businessHours: DEFAULT_BUSINESS_HOURS`.
5. `apps/api/src/bootstrap/__tests__/google-calendar-factory.test.ts`: stays green after the constant
   move (regression guard on the consolidation).

## Done when

Fresh-org-resolves-Local proven by test, the producer-population ships in this PR (not inert),
typecheck + the touched package suites + build + lint + format:check are green, and a focused PR is
squash-merged to main.
