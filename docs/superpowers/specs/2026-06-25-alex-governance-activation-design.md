# Alex governance activation (P2-A): seed observe-by-default on provisioning

**Date:** 2026-06-25
**Status:** Design (approved by the activation owner; OBSERVE-by-default + per-org enforce flip)
**Branch:** `fix/alex-activation`

## 1. Problem

Five Alex `afterSkill` governance gates shipped and are wired into the live skill
runtime: banned-phrase, claim-classifier, PDPA-consent, WhatsApp-window, and the new
deterministic price gate (PR #1272). For every real (non-demo) org they are **inert**.

The cause is a single missing write. Real-org Alex deployments are provisioned by
`apps/api/src/lib/ensure-alex-listing.ts`, which upserts the deployment with **no
`governanceConfig`**. The resolver (`createAgentDeploymentGovernanceResolver`) then
returns `{status:"missing"}`, and every gate returns early before doing anything. The
only seeded `governanceConfig` is `MEDSPA_PILOT_GOVERNANCE_CONFIG` (observe), written
only for the demo org `org_demo` in `seed-marketplace.ts`.

The merged price gate anticipates this exact work in its own comment
(`price-claim-gate.ts:87`): the deterministic family "is what the activation gate (P2-A)
flips."

This is the highest-leverage safe unlock: turn the governance you already built from
`missing` (no signal, no capability) to `observe` (full telemetry, zero conversational
risk), which is the required precondition for a later per-org enforce flip.

## 2. Current state (verified against `origin/main` cdce15525)

**Storage.** `governanceConfig` is a nullable `Json` column on `AgentDeployment`, keyed
per `(organizationId, listingId)`. No separate table, no migration required: the column
exists and `GovernanceConfigSchema` uses `.passthrough()` for per-gate sub-blocks.

**Shape** (`packages/schemas/src/governance-config.ts`). Required `jurisdiction`
(`"SG"|"MY"`) and `clinicType` (`"medical"|"nonMedical"`), plus per-gate mode sub-blocks:
`deterministicGate.mode` (shared by banned-phrase **and** price gate),
`claimClassifier.mode`, `consentState.mode`, `whatsappWindow.{enabled,mode}`,
`recovery.mode`, `lifecycleTagging.{mechanical,qualification}.mode`. Every mode defaults
to `off`.

**Resolver.** `null`/absent config -> `{status:"missing"}` -> gates pass through. A valid
config -> `{status:"resolved"}`. A corrupt config -> `{status:"error"}`.

**Observe semantics (the safety floor).** In `observe`, all five gates record a verdict
and **leave `result.response` unchanged** (e.g. price gate line 148
`if (mode === "observe") return; // Telemetry only — output unchanged`). The posture
cache only arms the fail-closed-on-resolver-error branch when it last saw `enforce`;
seeding `observe` never arms it. **Seeding observe cannot alter or block a reply.**

**Producer dependence (matters only at enforce).**

| Gate             | Mode key                 | Producer for enforce                                                         | Observe behaviour  |
| ---------------- | ------------------------ | ---------------------------------------------------------------------------- | ------------------ |
| banned-phrase    | `deterministicGate.mode` | static jurisdiction list (self-contained)                                    | log only           |
| price            | `deterministicGate.mode` | playbook `services[].price`                                                  | log only           |
| claim-classifier | `claimClassifier.mode`   | `ApprovedComplianceClaim` rows (+ jurisdiction-agnostic regulatory fallback) | detached telemetry |
| PDPA-consent     | `consentState.mode`      | per-contact consent records                                                  | log only           |
| WhatsApp-window  | `whatsappWindow.mode`    | thread/contact state                                                         | log only           |

**F15, refined by reading current code.** The audit claimed `{{CLAIM_BOUNDARIES}}` is
"never populated" and business-facts is silently empty. Current code contradicts the
first half: `seedAlexSkillPack` seeds the `claim-boundaries` policy scope for every org
(it runs in the GET /config path), so the prompt slot is populated. The claim-boundaries
content is advisory (prompt-only); it does not feed the classifier's substantiation
resolver, which uses `ApprovedComplianceClaim` + regulatory sources. Business-facts is
genuinely operator data (real hours/services/prices), and its empty state is **already
surfaced loudly**: `checkBusinessFactsPresent` (advisory readiness check) plus the
`policyContextSlotEmpty` metric in `builders/alex.ts`. Net: the producer-population
machinery for a future enforce flip already largely exists; the missing piece is the
`governanceConfig` seed itself.

## 3. Design decisions

**(a) Default posture: OBSERVE.** Seed `buildObserveGovernanceConfig` on provisioning.
Observe is telemetry-only for all five gates, so it cannot break an existing real-org
conversation, and it immediately produces the governance signal an operator needs to
decide on enforce. Enforce-by-default would be unsafe precisely because the producers
(approved prices, approved claims) are empty on a fresh tenant: the price gate would
block every priced reply and the classifier would escalate every efficacy claim. Enforce
is therefore a deliberate, per-org, post-bake operator action, not a default.

**Enforce flip mechanism.** `governanceConfig` is a per-deployment JSON column. Flipping a
gate to enforce is an update to that column (today via ops; an operator-facing per-gate
control is a named follow-up, out of scope here). This slice makes the flip both
_possible_ (config seeded and resolvable) and _safe when taken_ (producers already
surfaced at readiness).

**(b) What to seed: `governanceConfig` (observe) only.** Claim-boundaries is already
seeded by `seedAlexSkillPack`. Business-facts is operator data and is already surfaced.
We do not fabricate operator facts; we light up the gates as telemetry and rely on the
existing readiness checks for enforce-readiness.

**(c) Where it lives: the lowest-level primitive `ensureAlexListingForOrg`.** Both
provisioning paths (GET /config lazy upsert and POST /provision transaction) call it, so
seeding there covers both for free and is robust against a future path forgetting the
seed. `governanceConfig` is a property of the Alex deployment, so seeding it where the
deployment is upserted is cohesive. The `create` branch sets it; pre-existing
deployments (the real-org gap) are backfilled **only when `governanceConfig` is null**, so
an operator's later enforce flip is never clobbered.

**(d) Coordination with F3.** F3 (per-org Riley/Mira provisioning + handoff governance)
is a separate, larger slice. It can seed Riley/Mira `governanceConfig` using the same
`buildObserveGovernanceConfig` factory. This slice stays Alex-scoped and does not touch
F3 territory.

**(e) Deriving jurisdiction/clinicType.** OrganizationConfig stores neither. The only
proxy is `businessHours.timezone` (often null at provisioning). We derive jurisdiction
from the timezone when present (`Asia/Kuala_Lumpur` -> `MY`, else `SG`) and default
clinicType to `medical` (the stricter posture). Default is `SG`/`medical`, matching the
pilot. In observe these values only label telemetry and pick the static rule list; a
defaulted value cannot harm a conversation. Capturing the real jurisdiction/clinicType at
onboarding (and updating the seeded config) is a named follow-up.

## 4. Approaches considered

1. **Seed observe in `ensureAlexListingForOrg` (chosen).** One change covers both paths;
   create + only-if-null backfill; non-clobbering; idempotent. Smallest blast radius,
   no migration, no seed.ts change (org_demo already observe).
2. **Seed in `provisionOrgAgentDeployments` (the F3 spine).** Rejected: that function is
   Riley/Mira-centric, runs only from GET /config (not the provision route), and seeding
   Alex's deployment config inside a Riley function is a poor fit.
3. **A new provisioning step in the route.** Rejected: more wiring, less DRY, and it must
   be added in two places (GET /config and POST /provision) or it misses a path.

## 5. Components

1. **`deriveAlexGovernanceSeedContext(orgConfig)`** (new, `apps/api/src/lib`). Pure:
   `{ businessHours?: unknown } | null -> { jurisdiction, clinicType }`. Timezone ->
   jurisdiction; default `SG`/`medical`. Co-located test.

2. **`ensureAlexListingForOrg(orgId, db, opts?)`** (modify). New optional
   `opts.governanceSeedContext`. Build `buildObserveGovernanceConfig(ctx)` (default
   `SG`/`medical`). Set it in the `create` branch; if the upserted row's
   `governanceConfig` is null, backfill via a conditional `updateMany` scoped to
   `{ id, governanceConfig is null }`. The `update: {}` branch stays a no-op so existing
   fields are never disturbed.

3. **GET /config wiring** (`routes/organizations.ts`). Pass
   `deriveAlexGovernanceSeedContext(config)` into `ensureAlexListingForOrg`. The POST
   /provision path passes nothing (safe default), since it does not load org config.

4. **`governance-config-seeded` readiness check** (`routes/readiness.ts`). Extend the
   deployment select + context with `governanceConfig`; add `governanceActivated`
   (`GovernanceConfigSchema.safeParse(...).success`); add an **advisory (non-blocking)**
   check. Advisory because a missing config does not stop safe operation (gates simply
   pass through, the pre-existing behaviour); it only means governance telemetry is not
   yet active. This avoids the "block the good state" anti-pattern and any transient
   false-block, while still proving the activation landed at the operator surface.

## 6. Data flow

```
GET /config (or POST /provision)
  -> ensureAlexListingForOrg(orgId, db, { governanceSeedContext })
       -> upsert AgentDeployment (create: governanceConfig = observe)
       -> if row.governanceConfig == null: updateMany({id, governanceConfig is null}) = observe
  -> resolver(deploymentId) now returns {status:"resolved", config: observe}
  -> each afterSkill gate runs in observe: records a verdict, response UNCHANGED

GET /:agentId/readiness
  -> buildReadinessContext reads deployment.governanceConfig
  -> checkGovernanceConfigSeeded: pass iff a valid config resolves (advisory)
```

## 7. Safety: inertness, and how it is proven

Two independent guarantees, each with a test:

1. **Structural (by construction).** `buildObserveGovernanceConfig` has every gate mode in
   `{observe, off}` and never `enforce`. A parity test asserts this over the seeded
   artifact, so the seed can never block by construction.

2. **Behavioural (worst case).** The price gate is the gate most likely to block on a
   fresh tenant (empty approved prices means every currency amount is "unsubstantiated").
   A test drives `PriceClaimGateHook` with exactly the seeded config
   (`buildObserveGovernanceConfig`) and an **empty** approved-price list against a reply
   containing a price, then asserts `result.response` is unchanged and no
   status flip/handoff occurred (a verdict with `action:"allow"` is recorded). This ties
   the seeded artifact to "cannot block, even with zero producer facts."

Non-clobber and idempotency are proven in the `ensureAlexListingForOrg` tests: an
existing `enforce` (or any non-null) config is never overwritten; a null config is
backfilled to observe; repeat calls are stable.

## 8. Testing strategy

- `alex-governance-seed-context.test.ts`: timezone derivation + defaults.
- `ensure-alex-listing.test.ts` (extend): new deployment seeded observe by default and by
  passed context; null backfilled; non-null (enforce) not clobbered; idempotent.
- Parity test on `buildObserveGovernanceConfig`: no enforce anywhere; `resolveGovernanceMode` = observe.
- Price-gate inertness test (core): seeded observe + empty prices + priced reply -> unchanged.
- Readiness test (extend): valid config -> advisory pass; null -> advisory fail (does not
  change `ready`); malformed -> advisory fail.

Verification: `pnpm --filter @switchboard/schemas|core|api typecheck` + targeted tests +
full `pnpm test`. No schema change, so no `db:check-drift`.

## 9. Scope

**In scope:** seed observe `governanceConfig` on both provisioning paths; jurisdiction/
clinicType derivation; advisory `governance-config-seeded` readiness check; the tests
above.

**Explicitly deferred (named, not started):**

- Operator-facing per-gate enforce-flip control (route/UI to write `governanceConfig`).
- Onboarding capture of real jurisdiction/clinicType and an update path for the seeded config.
- F3: per-org Riley/Mira deployment + handoff-governance provisioning (reuses this factory).
- Populating real business-facts / approved-prices / approved-claims (operator onboarding data).

These are genuine follow-ups, not deferrable correctness gaps in this slice: observe is
complete and safe on its own, and the enforce-readiness signals already exist at readiness.

## 10. Risks and limitations

- A defaulted `SG`/`medical` jurisdiction can mislabel observe telemetry for an MY or
  non-medical clinic until real capture exists. No conversational impact in observe.
- Backfill of existing orgs happens on the next GET /config load (idempotent). Orgs that
  never load config stay unseeded until they do; acceptable for a pre-launch product.
- The advisory readiness check is informational; it does not gate go-live (by design).
