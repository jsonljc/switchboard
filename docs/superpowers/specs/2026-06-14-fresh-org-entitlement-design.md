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

**Guardrail (the comp is launch and pilot only).** `entitlementOverride: true` is set ONLY by trusted
org provisioning paths: dashboard signup (`provisionDashboardUser`) and the auth-scoped lazy
`GET /config`. It is a pilot entitlement, not a permanent comp. Billing-live must enumerate and clear
or classify all existing overrides (see "Required follow-up at billing-live"). This was the central
caution from plan review: this seam decides who becomes entitled, automatically, and forever, so it
stays scoped to trusted producers and has a named unwind.

## Scope

In scope:

- Set `entitlementOverride: true` in `provisionDashboardUser` (dashboard signup, inline with an F-02
  comment) and in the `organizations.ts` lazy `GET /config` create branch, mirroring how F-01 (#1024)
  seeded `businessHours` at the same two sites.
- Extract the lazy-create defaults into a small co-located module
  (`apps/api/src/lib/org-config-defaults.ts`). This is the single documented source for the API
  fresh-org config defaults, and it drops `organizations.ts` about ten lines clear of the 600-line
  arch limit (the file is 598 now). The module's doc comment carries the trusted-path safety note.
- Tests pinning the producer, the defaults source, the producer-to-consumer seam, and one real
  enforcement chokepoint (see Test strategy).

Out of scope (flagged, not fixed here):

- **OAuth signup is not launch-mode gated.** `apps/dashboard/src/lib/auth.ts` `createUser` calls
  `provisionDashboardUser` unconditionally, so Google sign-in provisions an org even in `waitlist`
  mode. That is a registration-gating gap that belongs to F-05 (launch-mode enforcement), not F-02.
  Until F-05 closes it, the comp's exposure equals the registration surface. Noted so it is not
  forgotten.
- F-05 (launch-mode), F-09 (trustHost), F-20 (client flag). Not folded in.

## Why the lazy GET /config path is safe to seed entitlement

Seeding `entitlementOverride` from a GET route is a powerful side effect, so it is worth stating why
it cannot become a billing bypass. The lazy `GET /config` create branch is reachable only after
`requireOrganizationScope` (`apps/api/src/utils/require-org.ts`) authenticates the caller, and the
handler then returns 403 unless the URL `orgId` equals the authenticated `authOrgId` (proven by the
existing "returns 403 for wrong org" test). So a caller can seed entitlement only for the org they are
ALREADY authenticated as, never an arbitrary org and never another tenant's. Authentication itself is
minted only by trusted provisioning: the API key / session is created inside `provisionDashboardUser`
in the same transaction as the `OrganizationConfig` row, so a normally provisioned org already has
its config and never reaches the create branch. The branch fires only for an authenticated org whose
config row is somehow absent, and it can only comp that same authenticated org. Entitling an org you
already control is not a privilege escalation. If org identity could ever be authenticated WITHOUT
trusted provisioning, this assumption must be revisited and the lazy path must stop seeding
entitlement.

## Non-goals

- No schema default change. The defaults (`none`/`false`) stay correct for non-provisioning create
  paths, for legacy rows, and for the billing-live future. Setting the field at the producer is
  strictly narrower than flipping the schema default, and it avoids a migration.

## Test strategy (TDD)

Write each failing test first and watch it fail for the right reason before implementing. The tests
span the whole chain so the fix cannot be inert: producer writes the field, the defaults source comps
the org, and a real enforcement chokepoint lets a fresh org through.

1. **Dashboard producer + seam** (`apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts`):
   assert `organizationConfig.create` is called exactly once, capture the payload, assert
   `entitlementOverride === true`, then feed the provisioned values (`subscriptionStatus` defaults to
   `"none"` since the producer omits it, plus the producer-set `entitlementOverride`) into
   `evaluateEntitlement` and assert `{ entitled: true, reason: "override" }`. The called-once guard
   makes the position-zero mock read explicit instead of fragile.
2. **Defaults source seam** (`apps/api/src/lib/__tests__/org-config-defaults.test.ts`, new): assert the
   extracted `LAZY_ORG_CONFIG_CREATE_DEFAULTS` carries `entitlementOverride: true` and evaluates to
   entitled. This pins the API producer-of-record from the real defaults object.
3. **API lazy-create uses the defaults** (`apps/api/src/__tests__/api-organizations.test.ts`): extend
   the "auto-creates default config" test to assert the `upsert` `create` objectContaining includes
   `entitlementOverride: true`, proving the route passes the comped defaults through (the seam itself
   is owned by test 2). Mirrors the existing `businessHours: DEFAULT_BUSINESS_HOURS` assertion.
4. **Real enforcement chokepoint**
   (`apps/api/src/middleware/__tests__/billing-guard.integration.test.ts`): construct a fresh org's
   actual DB row (`{ subscriptionStatus: "none", entitlementOverride: true }`), run it through the
   real `PrismaBillingEntitlementResolver` and the `billingGuard`, and assert a mutating
   `POST /api/actions/propose` returns 200, not 402. This is the F-02 regression: it proves the exact
   tuple a fresh org is provisioned with survives the actual gate, not just the pure function.

The consumer pure function is already covered: `entitlement.test.ts` has an "override wins regardless
of status" case over a status set that includes `"none"`, so no separate consumer test is added (it
would duplicate existing coverage).

## Risks and mitigations

- **`organizations.ts` line budget.** The file is 598 lines against a 600-line arch-check hard cap.
  Rather than the brittle one-line patch (which would sit at 599, one edit from breaking), the plan
  extracts the lazy-create defaults into `apps/api/src/lib/org-config-defaults.ts`, which removes the
  inline object and the now-unused `DEFAULT_BUSINESS_HOURS` import and drops the route to about 588
  lines. Verify `wc -l` and `pnpm arch:check` after the change. Do not fold in unrelated refactors.
- **Comp lifecycle.** `entitlementOverride: true` has no built-in expiry, so it must be unwound
  deliberately at billing-live (see the named follow-up below). The guardrail keeps it set only by
  trusted producers in the meantime.

## Required follow-up at billing-live (named, not in F-02)

This must happen when billing goes live (`NEXT_PUBLIC_LAUNCH_MODE=public` and Stripe enabled), and it
is named here so it is not forgotten. It does NOT block F-02.

1. Switch provisioning off the unconditional comp: new orgs go through a real Stripe trial or checkout
   instead of `entitlementOverride: true`.
2. Run a one-time migration that enumerates every `entitlementOverride = true` org, classifies each as
   paid, trial, internal, or demo/test, and clears the override except for explicitly comped or
   internal accounts. Without this, pilot-era comps persist forever and mask genuine non-payment.
3. The comp is greppable by the `F-02` markers and `org-config-defaults.ts`, so the cleanup has a
   precise inventory of where the override is produced.

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
