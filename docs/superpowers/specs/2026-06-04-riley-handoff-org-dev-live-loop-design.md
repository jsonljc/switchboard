# Riley to Mira handoff: make the governed loop fire end-to-end on one org

Date: 2026-06-04
Status: design approved (autonomous slice)

## Problem

Contract 3 (`adoptimizer.recommendation.handoff`) is fully WIRED on origin/main
(PR #854 + #856): the weekly-audit cron calls a bootstrap-injected
`recommendationHandoffSubmitter` for every emitted creative recommendation that
clears Riley's abstention, which synthesizes a brief and submits a governed
handoff through the real `PlatformIngress`. The real `GovernanceGate` parks it at
mandatory approval, and on approval the handoff handler creates a Mira
`creative.concept.draft` child (a no-spend `CreativeJob` row that surfaces on
`/mira`).

The live path is INERT on currently-seeded orgs because the five required pieces
are DISJOINT across orgs, so no single org can fire it end-to-end:

1. An ACTIVE ad-optimizer (Riley) `AgentDeployment` (so the weekly-audit cron's
   `listActiveDeployments` returns the org).
2. The seeded handoff governance policies (allow + require_approval(mandatory) for
   `adoptimizer.recommendation.handoff`).
3. The global seeded `{id:"system",type:"system"}` principal + its IdentitySpec.
4. An active `skillSlug="creative"` AgentDeployment (the child draft target).
5. Mira enabled for the org (`OrgAgentEnablement`).

Verified against origin/main:

- `packages/db/prisma/seed.ts` installs pieces 2, 4, 5 for `org_dev` only
  (`seedMiraCreativeDeployment("org_dev")` seeds the creative deployment AND the
  handoff allow + mandatory policies; `seedMiraPilotOrgs(["org_dev"])` enables
  Mira).
- Piece 3 is global (`prisma.principal.upsert({id:"system"})` in `seed.ts`, plus
  the `default` IdentitySpec keyed on the system principal).
- Piece 1 (active ad-optimizer deployment) is seeded only for `org_demo`
  (`seedDemoData` in `seed-marketplace.ts`, `ORG_ID="org_demo"`).

So `org_dev` has pieces 2/4/5 (+ global 3) but lacks piece 1, and `org_demo` has
piece 1 but lacks 2/4/5. Neither org can fire the loop.

This slice closes that gap and PROVES the loop fires with a real-path integration
test. It is the honest completion of #854's flagged caveat: turn "wired but inert"
into "live and demonstrable."

## Decisions

### Which org to fully enable: `org_dev`

`org_dev` already carries 3 of the 5 pieces (2/4/5) plus the global system
principal (3). It is the org `/mira` renders for under dashboard dev-auth, so a
developer who connects Meta and triggers the cron sees the full loop on the org
they actually view. Adding only the missing piece 1 (an active ad-optimizer
deployment) to `org_dev` completes the set with the smallest, most local change.

`org_demo` is the marketplace landing demo. It keeps its own ad-optimizer
deployment; this slice does not touch `seedDemoData`, so `org_demo` is unchanged.
We do NOT add the Mira pieces to `org_demo` (out of scope; it is a public-landing
fixture org, not the dev cockpit org).

### Seed shape: a new idempotent `seedRileyAdOptimizerDeployment`

Mirror `seedMiraCreativeDeployment`: a small, reusable, idempotent seed function
in `packages/db/src/seed/` that resolves the `ad-optimizer` listing (seeded by
`seedMarketplace`) and upserts an ACTIVE `AgentDeployment` with
`skillSlug="ad-optimizer"` scoped to the org (`organizationId_listingId` unique).
It throws a clear error if the listing is missing (fail loud), and is idempotent
(re-running re-activates). It carries the same posture as the established Riley
deployment on `org_demo` (`inputConfig` budget/target fields,
`governanceSettings: { trustLevelOverride: "autonomous" }`). The mandatory handoff
approval policy is non-downgradeable and is unaffected by `trustLevelOverride`, so
the handoff still parks regardless of posture.

We do NOT refactor `org_demo`'s inline ad-optimizer deployment into the shared
function in this slice (lower risk; `org_demo` keeps working untouched). The new
function is called from `seed.ts` for `org_dev` only, right after
`seedMiraCreativeDeployment("org_dev")` and after `seedMarketplace` (the listing
must already exist).

Co-located unit test mirrors `seed-mira-creative-deployment.test.ts` (mocked
Prisma; CI has no Postgres): asserts the upsert is org+listing scoped, active,
`skillSlug="ad-optimizer"`, idempotent, and throws when the listing is missing.

### The #1 deliverable: a full-loop integration test driving the REAL path

A new co-located test, `recommendation-handoff-cron-full-loop.test.ts`, drives the
REAL `executeWeeklyAudit(step, deps)` from `@switchboard/ad-optimizer` (added to
the barrel; the sibling `executeDailySignalHealthCheck` and
`executeRileyOutcomeAttributionDispatch` are already exported for their tests, so
exporting `executeWeeklyAudit` for the same reason is consistent). It is a NEW
file rather than an extension of `recommendation-handoff-cron-live-path.test.ts`
because adding the full-loop scaffolding to that 330-line file would approach the
600-line arch-check error cap; the new file mirrors the proven harness.

The test wires REAL components end-to-end:

- A SYNTHETIC Meta insight provider + ads client + CRM provider (the only
  test-supplied inputs) engineered so the AuditRunner's decision engine produces
  an eligible `refresh_creative` recommendation:
  - current vs previous campaign insight: inline link clicks halve (CTR down,
    significant), frequency rises (significant), impressions and spend flat (CPM
    stable, not significant), conversions drop proportionally (CPA rises, conv/click
    rate flat so `measurementTrusted=true`). This yields a `creative_fatigue`
    diagnosis, which the engine maps to `refresh_creative` (diagnostic evidence
    family; floor clicks>=10/conv>=0/days>=3, easily met).
  - learning provider returns a NON-learning status (`learningPhase:false`), so the
    campaign is not learning-locked and `refresh_creative` (resetsLearning "yes")
    survives.
  - CRM funnel data has leads>=30, so the economic tier resolves to `cpl` (not
    `cpc`), and `applyTier` keeps `refresh_creative` (cpc would withhold it).
- A real-returning `recommendationEmitter` that returns `{surface:"queue", id}`
  (the same contract the production `emitRecommendation` returns). It stands in for
  the separately-tested Recommendation-row persistence; the handoff only consumes
  `result.id` and `result.surface`.
- A `recommendationHandoffSubmitter` closure that MIRRORS production exactly:
  `synthesizeCreativeBrief(...)` then `buildRecommendationHandoffSubmitRequest(...)`
  then the REAL `ingress.submit(...)` (replicating both the `inngest.ts` closure and
  the `contained-workflows.ts` `submitRecommendationHandoff` closure).
- The REAL `PlatformIngress` + REAL `GovernanceGate` (with the seeded allow +
  require_approval(mandatory) policies from the shared `@switchboard/db` builders +
  the seeded `system` principal IdentitySpec), REAL `IntentRegistry`,
  `ExecutionModeRegistry`, `WorkflowMode`.
- The REAL `buildRecommendationHandoffWorkflow()` handler and the REAL
  `buildCreativeConceptDraftWorkflow(deps)` handler (NOT a fake array-push handler),
  wired to in-memory stores. The child submit uses the REAL
  `createSubmitChildWork({platformIngress, deploymentResolver})`.
- The REAL `PrismaMiraCreativeReadModelReader` (the `/mira` route's reader) backed
  by a mock Prisma whose `creativeJob.findMany` returns the in-memory rows.

Assertions (the proof beyond the submit seam):

1. `executeWeeklyAudit` produces exactly one handoff submit (for
   `refresh_creative`; `restructure`, which co-fires, abstains as
   unroutable).
2. The handoff PARKS at mandatory: `res.ok && approvalRequired && outcome ===
"pending_approval"`, actor `{id:"system",type:"system"}` (never
   system_auto_approved).
3. On driving the approved handler (the proven-harness post-approval dispatch),
   the `creative.concept.draft` child executes through the real ingress and the
   REAL draft handler creates a `CreativeJob` row.
4. The new draft SURFACES via `PrismaMiraCreativeReadModelReader.read(org_dev)`:
   `rm.jobs` contains a job whose `title` equals the synthesized brief's
   `productDescription`, status `in_progress` (fresh "trends" draft), and
   `counts.total >= 1`.
5. A negative control: an un-seeded org (no allow policy) default-DENIES (no
   phantom success), mirroring the existing harness.

The approval LIFECYCLE transition itself (operator approve toggling state) is
covered by `apps/api/src/__tests__/api-approvals.test.ts`; this test drives the
post-approval handler dispatch directly, as the proven
`recommendation-handoff-cron-live-path.test.ts` harness does.

### Operator surfacing (task 3): audited, no handoff-specific gap; leave as-is

Traced the parked-approval to operator-UI path with two independent audits. The
dashboard Inbox decision feed (`/api/dashboard/decisions`,
`use-decision-feed.ts`) reads only `recommendationStore` + `handoffStore`; parked
workflow-intent approvals are not bridged into it. The legacy
`/api/approvals/pending` surface (which the dashboard no longer calls) builds a
terse `${workUnit.intent} (requested by ${actor.id})` summary via
`approval-factory.ts` for EVERY parked workflow intent.

Verdict: the parked handoff is NOT uniquely opaque. It is treated identically to
every other parked workflow approval (`creative.job.publish`,
`conversation.reminder.send`, `conversation.followup.send`). This is a
pre-existing, cross-cutting limitation of the approval/decision layer, not a
handoff-specific gap, and the handoff remains approvable via the lifecycle/approval
API. Bridging parked WorkUnit approvals into the decision-feed Inbox (or
humanizing the approval summary per intent) is a worthwhile but cross-cutting
change affecting all intents, with its own design and test surface. It is out of
scope for "make the loop fire and prove it" and is flagged as a follow-up. This
slice does not modify the approval/decision rendering.

## Files

- NEW `packages/db/src/seed/seed-riley-ad-optimizer-deployment.ts` (+ co-located
  `.test.ts`).
- EDIT `packages/db/prisma/seed.ts`: call `seedRileyAdOptimizerDeployment("org_dev")`
  after `seedMiraCreativeDeployment("org_dev")`.
- EDIT `packages/db/src/index.ts` (or seed barrel) to export the new seed function
  if other seed functions are exported there (match the existing pattern).
- EDIT `packages/ad-optimizer/src/index.ts`: export `executeWeeklyAudit`.
- NEW `apps/api/src/__tests__/recommendation-handoff-cron-full-loop.test.ts`.

## Out of scope

- Refactoring `org_demo`'s inline ad-optimizer deployment.
- Any change to the Contract 3 wiring (#854/#856) itself.
- Bridging parked WorkUnit approvals into the dashboard decision feed (cross-cutting
  follow-up).
- A real Meta connection or a live cron trigger (an operator step; this test proves
  the path with a synthetic insight). See "Honest limits" below.

## Honest limits (what still needs an operator step for a real-data demo)

The Inngest weekly cron does not auto-fire locally; a real-data live demo needs an
operator to (a) connect a Meta Ads account to the `org_dev` ad-optimizer deployment
so `getDeploymentCredentials` + `MetaCampaignInsightsProvider` return real
insights, and (b) manually trigger the cron. The integration test proves the entire
governed path from a synthetic insight forward (engine to Mira read seam) without
those external dependencies.
