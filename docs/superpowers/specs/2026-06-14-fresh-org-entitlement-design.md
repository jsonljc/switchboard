# F-02: Fresh org entitlement at provisioning

- Date: 2026-06-14
- Branch: `fix/fresh-org-entitlement`
- Verified against: `origin/main` @ `99cd5993` (re-confirmed point-in-time, the F-02 finding is dated 2026-06-07)
- Finding: `docs/audits/2026-06-07-pilot-spine-audit/findings/F-02-fresh-org-entitlement-blocked.md`

## Problem

A freshly provisioned organization cannot take any mutating action. The platform billing
entitlement gate evaluates a fresh org as `entitled: false`, so every booking, send, or approval
is rejected with HTTP 402, and no provisioning path ever flips the org to entitled. With Stripe
disabled at pilot defaults there is no producer that can un-block the org, so a self-serve pilot
org is permanently bricked.

### Verified producer/consumer trace (current main @ 99cd5993)

Consumer (the gate):

- `packages/core/src/billing/entitlement.ts:14` `evaluateEntitlement` returns `entitled: true`
  only when `entitlementOverride === true`, or `subscriptionStatus` is `"active"` or `"trialing"`;
  everything else is `{ entitled: false, reason: "blocked" }`.
- Enforced at three chokepoints, all wired unconditionally in prod:
  - `packages/core/src/platform/platform-ingress.ts:214-224` (returns `entitlement_required`).
  - `apps/api/src/middleware/billing-guard.ts:71-78` (HTTP 402 on mutating, non-allowlisted routes).
  - `apps/api/src/utils/ingress-error-to-reply.ts:22-26` (maps `entitlement_required` to 402).

Producer gap (nothing entitles a fresh org):

- Schema defaults `packages/db/prisma/schema.prisma:444,449`: `subscriptionStatus @default("none")`,
  `entitlementOverride @default(false)`.
- The only writers of either field are the Stripe webhook handlers
  `apps/api/src/routes/billing.ts:223,231,271`. A repo-wide grep confirms no signup, seed, or
  provision path writes `subscriptionStatus` or `entitlementOverride`. `entitlementOverride` is
  never written outside tests.
- The two canonical org create-sites set neither field, so both fall to the blocking defaults:
  - `apps/dashboard/src/lib/provision-dashboard-user.ts:26-38` (self-serve signup, the real path).
  - `apps/api/src/routes/organizations.ts:66-80` (lazy `GET /config` upsert create branch).
- Stripe is off at pilot defaults (`.env.example`: `STRIPE_SECRET_KEY=` and
  `NEXT_PUBLIC_STRIPE_ENABLED=` empty), so there is no live path to reach `active`/`trialing`.

The finding holds on current main. This is a producer-population gap, not a gate bug: the gate is
correct, but no producer supplies an entitling value.

## Context that constrains the decision

- **Registration is already gated.** `apps/dashboard/src/app/api/auth/register/route.ts:12-21`
  rejects signup unless `NEXT_PUBLIC_LAUNCH_MODE` is `beta` or `public` (default `waitlist` returns
  403). During the pilot, self-serve signups are bounded to an invited cohort, not the open
  internet.
- **The pilot is comped.** The current stage is roughly 10 to 15 hand-vetted clinics with Stripe
  off (memory: revenue-loop north star). No org is being charged.
- **Entitlement is not the spend gate.** The billing entitlement gate answers "may this org use the
  product at all." It is distinct from governance spend limits and approval thresholds, which still
  apply to every financial action. Comping entitlement does not bypass spend or approval gates
  (memory: `feedback_system_auto_approved_bypasses_spend_gates` is about the governance spend
  short-circuit, a different gate).
- **`entitlementOverride` is the documented comped-pilot field.** Schema comment
  (`schema.prisma:446-448`): "Manual override that allows an org to execute paid mutable actions
  without an active Stripe subscription. Intended for internal beta, comped pilots, or manually
  approved exceptions."

## Reconciliation cron finding (the trialing risk)

`apps/api/src/services/cron/reconciliation.ts:131-166` `executeStripeReconciliation` iterates
`listSubscribedOrganizations()` and overwrites `subscriptionStatus` to match Stripe. The producer
of that list (`apps/api/src/bootstrap/inngest.ts:684-705`) filters
`stripeSubscriptionId: { not: null }` AND `subscriptionStatus: { notIn: ["none", "canceled"] }`,
then re-filters non-null sub IDs. So an org provisioned as `trialing` with no real Stripe
subscription (`stripeSubscriptionId = null`) is excluded twice and is never reconciled to
`canceled`. The "trialing" option is therefore safe against the cron today, but that safety is
non-local: it depends on this filter staying correct in a file far from the provisioning code.

## Options considered

### A. `entitlementOverride = true` at provisioning (recommended)

Set the comped-pilot field at both create-sites. `evaluateEntitlement` returns
`{ entitled: true, reason: "override" }`.

- Pros: uses the field for its documented purpose; fully decoupled from Stripe and from the
  reconciliation cron (the cron never reads or writes `entitlementOverride`), so there is zero risk
  of a comped pilot being flipped to `canceled`; `reason: "override"` is an honest, auditable signal
  ("this org is comped"); no schema change and therefore no migration.
- Cons: comps every org provisioned while this code is live. During the launch-mode-gated pilot
  that is bounded to invited orgs and is the intended behavior. When billing goes live, provisioning
  must switch to a real trial or checkout, and a one-time migration must clear pilot-era overrides
  for orgs that should convert. That transition is a deliberate, audited future milestone (the
  receipted-bookings live-flip), not a silent state change.

### B. `subscriptionStatus = "trialing"` at provisioning

- Pros: conventional SaaS trial; converges naturally once a real Stripe subscription arrives (the
  webhook overwrites `subscriptionStatus`).
- Cons: it is a fake trial with no `trialEndsAt` and no Stripe subscription, so it never expires;
  safety against the reconciliation cron is real but non-local (see above); `reason: "trialing"`
  misrepresents reality. Same "comps every signup" property as A, with murkier semantics.

### C. Manual runbook step (provision script sets `entitlementOverride` per vetted org)

- Pros: strongest billing integrity; the gate stays closed by default and only vetted orgs are
  comped.
- Cons: a freshly signed-up org is still 402-blocked until ops runs the script, so it does not
  satisfy the pilot-spine expectation that a self-serve org can act out of the box. It moves the gap
  rather than closing it for the self-serve path.

### Rejected: gate-level "no-op when billing disabled"

Making `evaluateEntitlement` or the resolver return entitled whenever billing is unconfigured would
fix all orgs at once, but it changes the semantics of the enforcement chokepoints, widens blast
radius across three enforcement points, risks accidentally un-gating a billing-live prod, and
diverges from the finding's provisioning-scoped fix. Not pursued.

### Considered refinement: comp only while billing is disabled

Condition the override on a "billing enabled" signal so the gate re-closes automatically once
billing goes live. Rejected for now on YAGNI and drift grounds: there is no single clean
cross-runtime predicate (`STRIPE_SECRET_KEY` is api-side; `NEXT_PUBLIC_STRIPE_ENABLED` is
dashboard-side), so the two create-sites would carry two different conditions, and the billing-on
branch has no consumer yet. The billing-live milestone must revisit provisioning regardless, so the
auto-re-gate property is better delivered there. The recommended spec documents that exit explicitly
so it is not a hidden landmine.

## Recommendation

Option A, unconditional, at both canonical create-sites, with the producer-population shipped in the
same PR as the fix so it is not inert (memory: `feedback_safety_gate_needs_producer_population`).
Rationale: it is the minimal surgical change that uses the field for its documented comped-pilot
purpose, it is the only option fully decoupled from the reconciliation cron, it needs no schema
change or migration, and the financial-gate lessons are satisfied because comping entitlement leaves
every governance spend and approval gate intact. Exposure during the pilot is bounded by the
launch-mode registration gate.

## Scope

In scope:

- Set `entitlementOverride: true` in `provisionDashboardUser` (dashboard signup) and in the
  `organizations.ts` lazy `GET /config` create branch, mirroring how F-01 (#1024) seeded
  `businessHours` at the same two sites.
- Tests pinning the producer and the producer to consumer seam (see Test strategy).

Out of scope (flagged, not fixed here):

- **OAuth signup is not launch-mode gated.** `apps/dashboard/src/lib/auth.ts` `createUser` calls
  `provisionDashboardUser` unconditionally, so Google sign-in provisions an org even in `waitlist`
  mode. That is a registration-gating gap that belongs to F-05 (launch-mode enforcement), not F-02.
  Until F-05 closes it, the comp's exposure equals the registration surface. Noted so it is not
  forgotten.
- F-05 (launch-mode), F-09 (trustHost), F-20 (client flag). Not folded in.

## Non-goals

- No schema default change. The defaults (`none`/`false`) stay correct for non-provisioning create
  paths, for legacy rows, and for the billing-live future. Setting the field at the producer is
  strictly narrower than flipping the schema default, and it avoids a migration.

## Test strategy (TDD)

Write each failing test first and watch it fail for the right reason before implementing.

1. **Dashboard producer + seam** (`apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts`):
   assert the captured `organizationConfig.create` payload has `entitlementOverride === true`, then
   feed the provisioned values (`subscriptionStatus` defaults to `"none"` since the producer omits
   it, plus the producer-set `entitlementOverride`) into `evaluateEntitlement` and assert
   `{ entitled: true, reason: "override" }`. This pins the seam from real producer output, mirroring
   the F-01 `businessHours` assertion at line 49-50.
2. **API lazy-create producer + seam** (`apps/api/src/__tests__/api-organizations.test.ts`):
   extend the "auto-creates default config" test to assert the `upsert` `create` objectContaining
   includes `entitlementOverride: true`, and run `evaluateEntitlement` over the created values to
   assert entitled. Mirrors the existing `businessHours: DEFAULT_BUSINESS_HOURS` assertion at
   line 135.
3. **Consumer documentation** (`packages/core/src/billing/__tests__/entitlement.test.ts`): add an
   explicit named case documenting the fresh-pilot tuple `{ subscriptionStatus: "none",
entitlementOverride: true } -> { entitled: true, reason: "override" }`. The existing
   override-wins loop already covers this mechanically; the named case ties it to provisioning.

## Risks and mitigations

- **`organizations.ts` is at the 600-line arch-check limit** (598 lines now; the hard cap means
  `wc -l` must stay <= 599). Adding the field as a single inline-commented line keeps it at 599.
  Verify `wc -l` and `pnpm arch:check` are green after the edit. Fallback if it would exceed: extract
  the lazy-create default object into a small co-located module and reference it, which reduces the
  route file rather than splitting it. Do not fold in unrelated refactors.
- **Billing-live exit (documented, out of scope):** when `NEXT_PUBLIC_LAUNCH_MODE=public` and Stripe
  is enabled, provisioning must switch to a real trial or checkout, and a one-time migration must
  clear pilot-era `entitlementOverride` for orgs that should convert. This PR makes the comp explicit
  and greppable (`F-02` comment + this spec) so that milestone is easy to find.

## Verification gate (before push)

`pnpm typecheck`; `pnpm --filter @switchboard/core --filter @switchboard/db --filter @switchboard/api test`;
`pnpm --filter @switchboard/dashboard build` (dashboard touched); `pnpm build`; `pnpm lint`;
`pnpm format:check`; `pnpm arch:check`; `CI=1 pnpm local:verify:fast`. The Postgres-down baseline
(3 db-integrity files: work-trace / ledger / greeting) is environmental, not a regression.

## Done when

F-02 is fixed and proven by TDD against current code; the producer-population ships in the same PR;
no migration is required; all verification-gate commands are green; the PR is squash-merged to main
with required checks (typecheck, lint, test, security, architecture) green; the worktree is removed
and the branch deleted; the pilot-spine memory note marks F-02 resolved with the durable lesson.
