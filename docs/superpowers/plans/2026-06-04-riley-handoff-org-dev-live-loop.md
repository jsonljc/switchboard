# Riley to Mira handoff live-loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `org_dev` the one missing piece (an active ad-optimizer deployment) so it carries all five pieces the governed Riley to Mira handoff needs, then prove the loop fires end-to-end with a real-path integration test.

**Architecture:** A new idempotent seed function adds piece 1 to `org_dev` (mirroring `seedMiraCreativeDeployment`). A new integration test drives the REAL `executeWeeklyAudit` with a synthetic Meta insight through the REAL ingress + gate + handoff handler + creative-draft handler + Mira read model.

**Tech Stack:** TypeScript, Prisma (mocked in tests; CI has no Postgres), vitest, `@switchboard/core` platform (PlatformIngress, GovernanceGate), `@switchboard/ad-optimizer` (AuditRunner, executeWeeklyAudit), `@switchboard/db` seed + read-model reader.

---

### Task 1: `seedRileyAdOptimizerDeployment` seed function + unit test

**Files:**

- Create: `packages/db/src/seed/seed-riley-ad-optimizer-deployment.ts`
- Test: `packages/db/src/seed/seed-riley-ad-optimizer-deployment.test.ts`

- [ ] **Step 1: Write the failing test** (mirror `seed-mira-creative-deployment.test.ts` mocked-Prisma pattern). Assert: looks up the `ad-optimizer` listing by slug; upserts an org+listing-scoped deployment with `status:"active"`, `skillSlug:"ad-optimizer"`; update branch re-activates; idempotent (two runs -> identical create payloads); throws when the listing is missing (and does NOT attempt a deployment write). Use `AD_OPTIMIZER_LISTING_SLUG` exported from the impl.

- [ ] **Step 2: Run test, verify it fails** (module not found).
      Run: `pnpm --filter @switchboard/db test seed-riley-ad-optimizer-deployment`

- [ ] **Step 3: Write the implementation:**

```ts
import type { PrismaClient } from "@prisma/client";

/** The marketplace listing that backs Riley. Seeded by seedMarketplace. */
export const AD_OPTIMIZER_LISTING_SLUG = "ad-optimizer";

/**
 * Seeds an ACTIVE AgentDeployment with skillSlug "ad-optimizer" (Riley) for the
 * given org. This is the cron-side prerequisite for the governed Riley -> Mira
 * handoff (Contract 3): the weekly-audit cron's listActiveDeployments filters to
 * the "ad-optimizer" listing's active deployments, so without this row the org
 * never runs an audit and never emits a handoff. The handoff governance policies +
 * the creative deployment + Mira enablement are seeded separately
 * (seedMiraCreativeDeployment + seedMiraPilotOrgs); all five must target the SAME
 * org for the loop to fire (see docs/superpowers/specs/
 * 2026-06-04-riley-handoff-org-dev-live-loop-design.md).
 *
 * Mirrors org_demo's Riley deployment posture (seed-marketplace.ts): autonomous
 * trust override + budget/target inputConfig. The mandatory handoff approval policy
 * is non-downgradeable, so the handoff still parks regardless of trust posture.
 *
 * Idempotent (upsert on organizationId_listingId). Must run AFTER seedMarketplace;
 * throws a clear error if the listing is missing so the seed fails loudly.
 */
export async function seedRileyAdOptimizerDeployment(
  prisma: PrismaClient,
  orgId: string,
): Promise<void> {
  const listing = await prisma.agentListing.findUnique({
    where: { slug: AD_OPTIMIZER_LISTING_SLUG },
    select: { id: true },
  });
  if (!listing) {
    throw new Error(
      `seedRileyAdOptimizerDeployment: listing slug="${AD_OPTIMIZER_LISTING_SLUG}" not found — ` +
        "run seedMarketplace first.",
    );
  }

  const config = {
    status: "active",
    skillSlug: "ad-optimizer",
    inputConfig: {
      monthlyBudget: "3000",
      targetCPA: "30",
      targetROAS: "2.5",
      auditFrequency: "weekly",
    },
    // SMB launch posture, matching org_demo's Riley deployment: auto-allow Riley's
    // reversible ad-optimization actions. The handoff's mandatory approval is
    // unaffected (non-downgradeable), so the handoff still parks for a human.
    governanceSettings: { trustLevelOverride: "autonomous" },
    connectionIds: [],
  } as const;

  await prisma.agentDeployment.upsert({
    where: {
      organizationId_listingId: { organizationId: orgId, listingId: listing.id },
    },
    create: { organizationId: orgId, listingId: listing.id, ...config },
    update: config,
  });
}
```

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Commit** `feat(db): seed an active riley ad-optimizer deployment for org_dev`.

---

### Task 2: Wire the seed into `seed.ts` + export `executeWeeklyAudit`

**Files:**

- Modify: `packages/db/prisma/seed.ts` (import + call after `seedMiraCreativeDeployment("org_dev")`)
- Modify: `packages/ad-optimizer/src/index.ts` (export `executeWeeklyAudit`)

- [ ] **Step 1:** In `seed.ts`, add the import alongside the other seed imports:
      `import { seedRileyAdOptimizerDeployment } from "../src/seed/seed-riley-ad-optimizer-deployment.js";`
      Then, immediately after the `seedMiraCreativeDeployment(prisma, "org_dev")` call + its `console.warn`, add:

```ts
// Riley ad-optimizer deployment (Contract 3 cron prerequisite). org_dev already
// has the handoff governance + creative deployment + Mira enablement; this is the
// missing fifth piece so the governed Riley -> Mira handoff can fire end-to-end on
// org_dev (the org /mira renders). org_demo keeps its own Riley deployment.
await seedRileyAdOptimizerDeployment(prisma, "org_dev");
console.warn("Seeded Riley ad-optimizer deployment for org_dev");
```

- [ ] **Step 2:** In `packages/ad-optimizer/src/index.ts`, add `executeWeeklyAudit` to the existing `export { ... } from "./inngest-functions.js";` block (next to `executeDailySignalHealthCheck`).

- [ ] **Step 3:** Build + typecheck the two packages:
      Run: `pnpm --filter @switchboard/ad-optimizer build && pnpm --filter @switchboard/db typecheck`
      Expected: clean.

- [ ] **Step 4: Commit** `feat(ad-optimizer): export executeWeeklyAudit for the full-loop proof`.

---

### Task 3: Full-loop integration test (the #1 deliverable)

**Files:**

- Create: `apps/api/src/__tests__/recommendation-handoff-cron-full-loop.test.ts`

This test drives the REAL `executeWeeklyAudit` with a synthetic insight that yields
a `refresh_creative` recommendation, through the REAL ingress + gate (seeded
policies) -> parks at mandatory -> drives the approved handler -> REAL
creative-draft handler creates a CreativeJob -> asserts it surfaces via the REAL
`PrismaMiraCreativeReadModelReader`.

Synthetic insight design (yields `creative_fatigue` -> `refresh_creative`):

- current: impressions 100000, inlineLinkClicks 1000, spend 5000, conversions 25,
  revenue 12000, frequency 3.0.
- previous: impressions 100000, inlineLinkClicks 2000, spend 5000, conversions 50,
  revenue 15000, frequency 2.0.
- This gives CTR 2.0 -> 1.0 (down, significant), frequency 2.0 -> 3.0 (up,
  significant), CPM 50 -> 50 (stable, not significant), CPA 100 -> 200 (rising).
  Clicks halve (not flat) so `measurementTrusted=true`. Learning provider returns
  `learningPhase:false`. CRM leads=100 (>=30) -> tier `cpl` (refresh_creative
  survives applyTier).

Reuse the harness shapes from `recommendation-handoff-cron-live-path.test.ts`
(systemSpec, allowPolicy, approvalPolicy, deploymentResolver, intent registrations)
and the synthetic fixtures from `packages/ad-optimizer/src/__tests__/audit-runner.test.ts`.

- [ ] **Step 1: Write the failing test** with these cases:
  1. `executeWeeklyAudit` with the synthetic deps submits exactly ONE handoff
     (refresh_creative), which PARKS at mandatory (`approvalRequired`, outcome
     `pending_approval`, actor `{id:"system",type:"system"}`).
  2. Driving the approved handoff handler (REAL `buildRecommendationHandoffWorkflow`
     - REAL `createSubmitChildWork`) executes the `creative.concept.draft` child
       and the REAL `buildCreativeConceptDraftWorkflow` creates a CreativeJob row.
  3. The new draft SURFACES via `PrismaMiraCreativeReadModelReader.read("org_dev")`:
     `rm.jobs` has a job whose `title === synthesizeCreativeBrief(null).productDescription`,
     status `in_progress`, `counts.total >= 1`.
  4. Negative control: an un-seeded org (no allow policy) default-DENIES (no
     phantom success).

  Key wiring:
  - `recommendationEmitter`: `async (input) => ({ surface: "queue", id: \`rec\_${input.action}\` })`.
  - `recommendationHandoffSubmitter`: synthesize brief via `synthesizeCreativeBrief(null)`,
    build via `buildRecommendationHandoffSubmitRequest`, submit via the REAL `ingress.submit`;
    capture `{ req, res }`.
  - In-memory `taskStore`/`jobStore`/`deploymentStore`/`enablementStore` for the
    creative-draft handler; `jobStore.create` materializes a full CreativeJob row
    (`currentStage:"trends"`, `stageOutputs:{}`, `mode:"polished"`, `stoppedAt:null`,
    `ugcPhase:null`, `ugcPhaseOutputs:null`, `ugcFailure:null`, `reviewDecision:null`,
    `createdAt`/`updatedAt` now) and records it.
  - `mockPrisma.creativeJob.findMany` returns the recorded rows filtered by org.
  - `step` shim: `{ run: async (_n, fn) => fn(), sendEvent: async () => {} }`.

- [ ] **Step 2: Run test, verify it fails** (assertions unmet / module wiring).
      Run: `pnpm --filter @switchboard/api test recommendation-handoff-cron-full-loop`

- [ ] **Step 3:** Iterate the synthetic values / wiring until GREEN (the design
      above is computed to be correct; adjust only if a schema field or guard differs).

- [ ] **Step 4: Run the full file, verify PASS.**
- [ ] **Step 5:** Keep the file under 400 lines (warn) / 599 raw (arch-check). Extract
      a small fixtures helper only if needed. Run `pnpm arch:check` if near the cap.
- [ ] **Step 6: Commit** `test(api): prove the riley->mira handoff fires end-to-end on org_dev`.

---

### Task 4: Full green gate + docs

- [ ] **Step 1:** `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check` (full green).
- [ ] **Step 2:** Commit spec + plan docs (this file + the design).
- [ ] **Step 3:** Open the PR; enable squash auto-merge after ALL commits pushed.

## Self-review

- Spec coverage: Task 1+2 = seed alignment (piece 1 -> org_dev); Task 3 = full-loop
  proof + negative control + Mira read-seam assertion; operator surfacing = audited,
  documented as out-of-scope (no code task). All spec sections covered.
- Placeholders: none (seed code is complete; test design is concrete with computed
  values).
- Type consistency: `seedRileyAdOptimizerDeployment`, `AD_OPTIMIZER_LISTING_SLUG`,
  `executeWeeklyAudit`, `synthesizeCreativeBrief`, `buildRecommendationHandoffSubmitRequest`,
  `buildRecommendationHandoffWorkflow`, `buildCreativeConceptDraftWorkflow`,
  `createSubmitChildWork`, `PrismaMiraCreativeReadModelReader` all match the real
  origin/main signatures verified during brainstorming.
