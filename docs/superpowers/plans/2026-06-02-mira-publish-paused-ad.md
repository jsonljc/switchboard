# Mira P2 — Governed `creative.job.publish` (parked Meta draft package) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a governed `creative.job.publish` intent that, on mandatory human approval, creates a self-contained PAUSED Meta draft package (campaign → ad set → ad creative → ad) for a completed, human-kept creative, persists the Meta IDs on the `CreativeJob`, and fails loud on any missing prerequisite — with activation unreachable.

**Architecture:** New Meta-client methods (`createAdCreative`, `createAd`, PAUSED-only) in `ad-optimizer` (L2); `CreativeJob` Meta-ID + `durableAssetUrl` columns (L4) with a `Zod` mirror; an org-scoped `require_approval(mandatory)` policy seeded next to the existing allow policy (the real claim-safety gate — `approvalPolicy` is decorative); a pre-flight `assertPublishable` service; an idempotent/resumable workflow handler that orchestrates the Meta chain inline via injected deps; and a `POST /creative-jobs/:id/publish` route mirroring the sibling creative routes (`lifecycle` class, reusing the existing 202 `pendingApprovalReply`). Spec: `docs/superpowers/specs/2026-06-02-mira-publish-paused-ad-design.md`.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), pnpm + Turborepo, Prisma (Postgres), Zod, Fastify, Vitest. Layers: `ad-optimizer`/`schemas` (L2), `db` (L4), `api` (L5).

**Worktree note:** Postgres is unreachable here. `prisma generate` (client codegen) works without a DB; `migrate dev`/`db:check-drift` need PG → the migration is hand-written and validated in CI. All unit tests mock Prisma (CI has no PG either).

---

## File structure

| File                                                                         | Responsibility                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                                           | `CreativeJob` gains 7 nullable columns (Meta IDs + status + `durableAssetUrl`). |
| `packages/db/prisma/migrations/<ts>_creative_job_meta_publish/migration.sql` | Hand-written `ALTER TABLE` (nullable TEXT, no defaults).                        |
| `packages/schemas/src/creative-job.ts`                                       | `CreativeJobSchema` Zod mirror of the new columns.                              |
| `packages/ad-optimizer/src/meta-ads-client.ts`                               | `createAdCreative`, `createAd` (PAUSED-only).                                   |
| `packages/db/src/seed/creative-governance.ts`                                | `buildCreativePublishApprovalPolicyInput` + rule/id helpers.                    |
| `packages/db/src/seed/seed-mira-creative-deployment.ts`                      | upsert the publish approval policy alongside the allow policy.                  |
| `packages/db/src/stores/prisma-creative-job-store.ts`                        | `updatePublishFields` (org-scoped checkpoint write).                            |
| `apps/api/src/services/creative-publish-preconditions.ts`                    | `assertPublishable` (single source of truth, route + handler).                  |
| `apps/api/src/services/workflows/creative-publish-workflow.ts`               | `buildCreativePublishWorkflow` handler (idempotent/resumable).                  |
| `apps/api/src/bootstrap/contained-workflows.ts`                              | register intent + handler + deps.                                               |
| `apps/api/src/routes/creative-pipeline.ts`                                   | `POST /creative-jobs/:id/publish` (pre-flight + submit + 202).                  |
| `apps/api/src/__tests__/creative-publish-gate.test.ts`                       | real-`GovernanceGate` safety proofs.                                            |

**Ad-content placeholders (documented):** a paused draft's `objective`, `targeting`, `message`, `linkUrl`, `callToAction`, and budget are **placeholders the operator finalizes in Ads Manager** (the locked framing). They come from one helper (`buildDraftAdContent`, Task 8) so they're single-sourced; resolving real values (booking link, targeting, copy from the creative + org config; currency-aware budget) is **go-live hardening** (spec §11), not PR B — and the path cannot execute in prod until then anyway.

---

## Task 1: CreativeJob Meta-publish columns (schema + Zod + migration)

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (model `CreativeJob`, after `reviewDecidedAt`)
- Modify: `packages/schemas/src/creative-job.ts:198-226` (`CreativeJobSchema`)
- Create: `packages/db/prisma/migrations/20260602000000_creative_job_meta_publish/migration.sql`
- Test: `packages/schemas/src/__tests__/creative-job.test.ts` (create if absent)

- [ ] **Step 1: Write the failing Zod test**

Create/append `packages/schemas/src/__tests__/creative-job.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CreativeJobSchema } from "../creative-job.js";

const BASE = {
  id: "job_1",
  taskId: "task_1",
  organizationId: "org_1",
  deploymentId: "dep_1",
  productDescription: "Botox lunchtime refresh",
  targetAudience: "women 30-50",
  platforms: ["instagram"],
  brandVoice: null,
  productImages: [],
  references: [],
  pastPerformance: null,
  generateReferenceImages: false,
  currentStage: "complete",
  stageOutputs: {},
  stoppedAt: null,
  mode: "polished",
  createdAt: new Date("2026-06-01"),
  updatedAt: new Date("2026-06-01"),
};

describe("CreativeJobSchema meta-publish fields", () => {
  it("defaults the new meta-publish fields to undefined when omitted", () => {
    const job = CreativeJobSchema.parse(BASE);
    expect(job.metaAdId).toBeUndefined();
    expect(job.metaPublishStatus).toBeUndefined();
    expect(job.durableAssetUrl).toBeUndefined();
  });

  it("accepts populated meta-publish fields", () => {
    const job = CreativeJobSchema.parse({
      ...BASE,
      metaVideoId: "vid_1",
      metaCampaignId: "camp_1",
      metaAdSetId: "set_1",
      metaCreativeId: "cr_1",
      metaAdId: "ad_1",
      metaPublishStatus: "parked_paused",
      durableAssetUrl: "https://cdn.example.com/a.mp4",
    });
    expect(job.metaAdId).toBe("ad_1");
    expect(job.metaPublishStatus).toBe("parked_paused");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test -- creative-job`
Expected: FAIL — populated-fields assertions fail (the schema strips unknown keys, so `metaAdId` is `undefined`).

- [ ] **Step 3: Add the fields to the Zod schema**

In `packages/schemas/src/creative-job.ts`, inside `CreativeJobSchema = z.object({ ... })`, add after `reviewDecidedAt`:

```ts
  // Meta publish (P2 parked draft package). All nullable/optional — populated only
  // by the creative.job.publish handler (and durableAssetUrl by PR A).
  metaVideoId: z.string().nullable().optional(),
  metaCampaignId: z.string().nullable().optional(),
  metaAdSetId: z.string().nullable().optional(),
  metaCreativeId: z.string().nullable().optional(),
  metaAdId: z.string().nullable().optional(),
  metaPublishStatus: z.string().nullable().optional(),
  durableAssetUrl: z.string().nullable().optional(),
```

- [ ] **Step 4: Add the columns to the Prisma model**

In `packages/db/prisma/schema.prisma`, in `model CreativeJob`, after the `reviewDecidedAt DateTime?` line (before `createdAt`):

```prisma
  // Meta publish (P2 parked draft package). Nullable — set by creative.job.publish.
  // durableAssetUrl is the PR A contract (durable assembled-creative URL); publish
  // fails loud CREATIVE_ASSET_NOT_DURABLE until it is populated.
  metaVideoId       String?
  metaCampaignId    String?
  metaAdSetId       String?
  metaCreativeId    String?
  metaAdId          String?
  metaPublishStatus String?
  durableAssetUrl   String?
```

- [ ] **Step 5: Write the migration SQL**

Create `packages/db/prisma/migrations/20260602000000_creative_job_meta_publish/migration.sql`:

```sql
-- CreativeJob: Meta parked-draft publish fields (all nullable, no defaults).
ALTER TABLE "CreativeJob" ADD COLUMN "metaVideoId" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "metaCampaignId" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "metaAdSetId" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "metaCreativeId" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "metaAdId" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "metaPublishStatus" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "durableAssetUrl" TEXT;
```

- [ ] **Step 6: Regenerate the Prisma client + run tests**

Run: `pnpm --filter @switchboard/db db:generate` (or `pnpm db:generate`) — works without Postgres.
Run: `pnpm --filter @switchboard/schemas test -- creative-job`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/schemas/src/creative-job.ts \
  packages/db/prisma/migrations/20260602000000_creative_job_meta_publish/migration.sql \
  packages/schemas/src/__tests__/creative-job.test.ts
git commit -m "feat(db): add CreativeJob meta-publish + durableAssetUrl columns"
```

---

## Task 2: `MetaAdsClient.createAdCreative`

**Files:**

- Modify: `packages/ad-optimizer/src/meta-ads-client.ts` (interfaces near :40-50; method near the other create methods :147-172)
- Test: `packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts` (inside the top-level `describe("MetaAdsClient", ...)`):

```ts
describe("createAdCreative", () => {
  it("posts an object_story_spec with page_id + video_data and returns the id", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "cr_new_1" }),
    });

    const result = await client.createAdCreative({
      name: "Mira draft creative",
      pageId: "page_123",
      videoId: "vid_999",
      message: "Lunchtime refresh",
      linkUrl: "https://clinic.example/book",
      callToActionType: "BOOK_TRAVEL",
    });

    expect(result).toEqual({ id: "cr_new_1" });

    const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(callUrl).toContain("act_123456/adcreatives");

    const callOpts = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(callOpts.body as string);
    expect(body.object_story_spec.page_id).toBe("page_123");
    expect(body.object_story_spec.video_data.video_id).toBe("vid_999");
    expect(body.object_story_spec.video_data.call_to_action.type).toBe("BOOK_TRAVEL");
    expect(body.object_story_spec.video_data.call_to_action.value.link).toBe(
      "https://clinic.example/book",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/ad-optimizer test -- meta-ads-client`
Expected: FAIL — `client.createAdCreative is not a function`.

- [ ] **Step 3: Implement `createAdCreative`**

In `packages/ad-optimizer/src/meta-ads-client.ts`, add the param interface near the other `*Params` interfaces (after `UploadCreativeAssetParams`, ~line 50):

```ts
interface CreateAdCreativeParams {
  name: string;
  pageId: string;
  videoId: string;
  message: string;
  linkUrl: string;
  callToActionType?: string;
  imageHash?: string;
}
```

Add the method after `uploadCreativeAsset` (before `updateCampaignStatus`):

```ts
  async createAdCreative(params: CreateAdCreativeParams): Promise<{ id: string }> {
    const body = {
      name: params.name,
      object_story_spec: {
        page_id: params.pageId,
        video_data: {
          video_id: params.videoId,
          message: params.message,
          ...(params.imageHash ? { image_hash: params.imageHash } : {}),
          call_to_action: {
            type: params.callToActionType ?? "LEARN_MORE",
            value: { link: params.linkUrl },
          },
        },
      },
    };

    const response = await this.post(`/${this.accountId}/adcreatives`, body);
    return { id: response.id as string };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/ad-optimizer test -- meta-ads-client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/meta-ads-client.ts packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts
git commit -m "feat(ad-optimizer): add MetaAdsClient.createAdCreative"
```

---

## Task 3: `MetaAdsClient.createAd` (PAUSED-only) + lock the ACTIVE guard

**Files:**

- Modify: `packages/ad-optimizer/src/meta-ads-client.ts`
- Test: `packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the test file (inside the top-level describe):

```ts
describe("createAd", () => {
  it("always sends status PAUSED and links the creative + ad set", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "ad_new_1" }),
    });

    const result = await client.createAd({
      name: "Mira draft ad",
      adSetId: "set_1",
      creativeId: "cr_1",
    });

    expect(result).toEqual({ id: "ad_new_1" });

    const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(callUrl).toContain("act_123456/ads");

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.status).toBe("PAUSED");
    expect(body.adset_id).toBe("set_1");
    expect(body.creative.creative_id).toBe("cr_1");
  });
});

describe("updateCampaignStatus ACTIVE guard (safety lock)", () => {
  it("throws and never calls fetch when asked to activate", async () => {
    await expect(client.updateCampaignStatus("camp_1", "ACTIVE")).rejects.toThrow(/SAFETY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer test -- meta-ads-client`
Expected: `createAd` test FAILs (`client.createAd is not a function`). The ACTIVE-guard test PASSES already (existing throw) — keep it as a regression lock.

- [ ] **Step 3: Implement `createAd`**

In `packages/ad-optimizer/src/meta-ads-client.ts`, add the param interface near the others:

```ts
interface CreateAdParams {
  name: string;
  adSetId: string;
  creativeId: string;
}
```

Add the method after `createAdCreative`:

```ts
  async createAd(params: CreateAdParams): Promise<{ id: string }> {
    // status is hardcoded PAUSED and intentionally NOT a parameter — there is no
    // path through this client to create a live ad. Activation is a human action
    // in Ads Manager (see updateCampaignStatus, which throws on "ACTIVE").
    const body = {
      name: params.name,
      adset_id: params.adSetId,
      creative: { creative_id: params.creativeId },
      status: "PAUSED",
    };

    const response = await this.post(`/${this.accountId}/ads`, body);
    return { id: response.id as string };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer test -- meta-ads-client`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/meta-ads-client.ts packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts
git commit -m "feat(ad-optimizer): add MetaAdsClient.createAd (paused-only) + lock ACTIVE guard"
```

---

## Task 4: `buildCreativePublishApprovalPolicyInput` (seed governance)

**Files:**

- Modify: `packages/db/src/seed/creative-governance.ts`
- Test: `packages/db/src/seed/__tests__/creative-governance.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `packages/db/src/seed/__tests__/creative-governance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildCreativePublishApprovalPolicyInput,
  creativePublishApprovalPolicyId,
} from "../creative-governance.js";

describe("buildCreativePublishApprovalPolicyInput", () => {
  it("is an org-scoped require_approval(mandatory) policy matching ONLY creative.job.publish", () => {
    const p = buildCreativePublishApprovalPolicyInput("org_1");
    expect(p.id).toBe(creativePublishApprovalPolicyId("org_1"));
    expect(p.organizationId).toBe("org_1");
    expect(p.effect).toBe("require_approval");
    expect(p.approvalRequirement).toBe("mandatory");
    expect(p.active).toBe(true);
    const cond = (
      p.rule as { conditions: Array<{ field: string; operator: string; value: string }> }
    ).conditions[0];
    expect(cond.field).toBe("actionType");
    expect(cond.operator).toBe("matches");
    // anchored + escaped so it matches publish exactly, never submit/continue/stop
    expect(new RegExp(cond.value).test("creative.job.publish")).toBe(true);
    expect(new RegExp(cond.value).test("creative.job.continue")).toBe(false);
    expect(new RegExp(cond.value).test("creative.job.submit")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/db test -- creative-governance`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Implement the builder**

Append to `packages/db/src/seed/creative-governance.ts`:

```ts
/**
 * Rule matching ONLY the publish intent. Anchored + escaped: the rule-evaluator
 * does an unanchored `new RegExp(value).test(actionType)`, so a bare
 * "creative.job.publish" would still match exactly here, but anchoring guarantees
 * it can never also fire on a future "creative.job.publish_*" intent.
 */
export const CREATIVE_PUBLISH_APPROVAL_POLICY_RULE = {
  conditions: [
    { field: "actionType", operator: "matches" as const, value: "^creative\\.job\\.publish$" },
  ],
};

export function creativePublishApprovalPolicyId(organizationId: string): string {
  return `policy_require_approval_creative_publish_${organizationId}`;
}

/**
 * Org-scoped mandatory-approval policy for `creative.job.publish` — the REAL
 * claim-safety gate. `approvalPolicy` on the intent registration is decorative
 * (the policy engine never reads it); this policy sets `policyApprovalOverride`,
 * which the engine DOES enforce. "mandatory" is also immune to the #788
 * spend-approval downgrade (which only relaxes "standard"). Must be seeded
 * together with the allow policy (see seed-mira-creative-deployment.ts) — an org
 * allowed but not gated would auto-publish.
 */
export function buildCreativePublishApprovalPolicyInput(organizationId: string) {
  return {
    id: creativePublishApprovalPolicyId(organizationId),
    name: "Require human approval to publish a creative as a paused Meta draft",
    description:
      "Publishing a creative as a paused Meta draft package always requires mandatory human approval (medspa claim safety).",
    organizationId,
    priority: 40,
    active: true,
    rule: CREATIVE_PUBLISH_APPROVAL_POLICY_RULE,
    effect: "require_approval",
    approvalRequirement: "mandatory",
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/db test -- creative-governance`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/seed/creative-governance.ts packages/db/src/seed/__tests__/creative-governance.test.ts
git commit -m "feat(db): add creative publish mandatory-approval policy builder"
```

---

## Task 5: Seed the publish approval policy in `seedMiraCreativeDeployment`

**Files:**

- Modify: `packages/db/src/seed/seed-mira-creative-deployment.ts`
- Test: `packages/db/src/seed/seed-mira-creative-deployment.test.ts`

- [ ] **Step 1: Write the failing test**

Append a test to `packages/db/src/seed/seed-mira-creative-deployment.test.ts` (mirror the file's existing mock-prisma setup; this is the shape to assert):

```ts
import { describe, it, expect, vi } from "vitest";
import { seedMiraCreativeDeployment } from "./seed-mira-creative-deployment.js";
import { creativePublishApprovalPolicyId, creativeAllowPolicyId } from "./creative-governance.js";

function makePrisma() {
  return {
    agentListing: { findUnique: vi.fn().mockResolvedValue({ id: "listing_1" }) },
    agentDeployment: { upsert: vi.fn().mockResolvedValue({}) },
    policy: { upsert: vi.fn().mockResolvedValue({}) },
  };
}

describe("seedMiraCreativeDeployment publish approval policy", () => {
  it("upserts BOTH the allow policy and the publish mandatory-approval policy", async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedMiraCreativeDeployment(prisma as any, "org_1");

    const upsertedIds = prisma.policy.upsert.mock.calls.map((c) => c[0].where.id);
    expect(upsertedIds).toContain(creativeAllowPolicyId("org_1"));
    expect(upsertedIds).toContain(creativePublishApprovalPolicyId("org_1"));

    const publishCall = prisma.policy.upsert.mock.calls.find(
      (c) => c[0].where.id === creativePublishApprovalPolicyId("org_1"),
    );
    expect(publishCall?.[0].create.effect).toBe("require_approval");
    expect(publishCall?.[0].create.approvalRequirement).toBe("mandatory");
  });
});
```

(If `creativeAllowPolicyId` is not yet exported from `creative-governance.ts`, it already is — confirmed at `creative-governance.ts`. If the existing test file uses a different prisma-mock helper, reuse that one instead of `makePrisma`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/db test -- seed-mira-creative-deployment`
Expected: FAIL — only the allow policy is upserted; the publish policy id is missing.

- [ ] **Step 3: Implement the second upsert**

In `packages/db/src/seed/seed-mira-creative-deployment.ts`, update the import and add a second upsert after the existing allow-policy upsert:

```ts
import {
  CREATIVE_GOVERNANCE_SETTINGS,
  CREATIVE_SPEND_APPROVAL_THRESHOLD,
  buildCreativeAllowPolicyInput,
  buildCreativePublishApprovalPolicyInput,
} from "./creative-governance.js";
```

After the existing `await prisma.policy.upsert({ ... })` (allow policy) block, add:

```ts
// The publish intent (creative.job.publish) is allowed by the creative.job.*
// allow policy above, but publishing a creative to Meta is a claim-bearing
// external action that MUST always park for human approval — so an org-scoped
// mandatory-approval policy is seeded TOGETHER with the allow policy. Without
// it, publish would be allowed-but-ungated and auto-execute. Idempotent.
const { id: publishPolicyId, ...publishPolicyData } =
  buildCreativePublishApprovalPolicyInput(orgId);
await prisma.policy.upsert({
  where: { id: publishPolicyId },
  create: { id: publishPolicyId, ...publishPolicyData },
  update: publishPolicyData,
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/db test -- seed-mira-creative-deployment`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/seed/seed-mira-creative-deployment.ts packages/db/src/seed/seed-mira-creative-deployment.test.ts
git commit -m "feat(db): seed mandatory publish-approval policy with the creative deployment"
```

---

## Task 6: `PrismaCreativeJobStore.updatePublishFields`

**Files:**

- Modify: `packages/db/src/stores/prisma-creative-job-store.ts` (add a method; mirror `updateProductionTier`)
- Test: `packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts` (or wherever the store's tests live — reuse the existing mock-prisma pattern)

- [ ] **Step 1: Write the failing test**

Append to the store's test file (mirror its existing mock-prisma setup):

```ts
import { describe, it, expect, vi } from "vitest";
import { PrismaCreativeJobStore } from "../prisma-creative-job-store.js";

describe("PrismaCreativeJobStore.updatePublishFields", () => {
  it("org-scopes the updateMany and returns the refreshed row", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirstOrThrow = vi.fn().mockResolvedValue({ id: "j1", metaAdId: "ad_1" });
    const prisma = { creativeJob: { updateMany, findFirstOrThrow } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaCreativeJobStore(prisma as any);

    const row = await store.updatePublishFields("org_1", "j1", {
      metaAdId: "ad_1",
      metaPublishStatus: "parked_paused",
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "j1", organizationId: "org_1" },
      data: { metaAdId: "ad_1", metaPublishStatus: "parked_paused" },
    });
    expect(row.metaAdId).toBe("ad_1");
  });

  it("throws when no row matches (cross-org / missing)", async () => {
    const prisma = {
      creativeJob: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirstOrThrow: vi.fn(),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaCreativeJobStore(prisma as any);
    await expect(store.updatePublishFields("org_1", "j1", { metaVideoId: "v" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/db test -- prisma-creative-job-store`
Expected: FAIL — `store.updatePublishFields is not a function`.

- [ ] **Step 3: Implement the method**

In `packages/db/src/stores/prisma-creative-job-store.ts`, add (after `updateProductionTier`), and ensure `CreativeJob` is imported (it already is):

```ts
  /**
   * Persist Meta publish checkpoint fields. Org-scoped updateMany (doctrine #12);
   * count===0 ⇒ missing/cross-org ⇒ throw. Called once per Meta object created so
   * the publish handler is resumable (each id is a checkpoint).
   */
  async updatePublishFields(
    organizationId: string,
    id: string,
    fields: Partial<
      Pick<
        CreativeJob,
        | "metaVideoId"
        | "metaCampaignId"
        | "metaAdSetId"
        | "metaCreativeId"
        | "metaAdId"
        | "metaPublishStatus"
      >
    >,
  ): Promise<CreativeJob> {
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: fields,
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } });
    return row as unknown as CreativeJob;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/db test -- prisma-creative-job-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-creative-job-store.ts packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts
git commit -m "feat(db): add PrismaCreativeJobStore.updatePublishFields checkpoint write"
```

---

## Task 7: `assertPublishable` pre-flight service

**Files:**

- Create: `apps/api/src/services/creative-publish-preconditions.ts`
- Test: `apps/api/src/services/__tests__/creative-publish-preconditions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/__tests__/creative-publish-preconditions.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { assertPublishable } from "../creative-publish-preconditions.js";

const KEPT_JOB = {
  id: "j1",
  organizationId: "org_1",
  currentStage: "complete",
  stoppedAt: null,
  reviewDecision: "kept",
  durableAssetUrl: "https://cdn.example/a.mp4",
};

function deps(
  overrides: {
    job?: unknown;
    connection?: unknown;
    creds?: Record<string, unknown>;
  } = {},
) {
  return {
    prisma: {
      creativeJob: { findUnique: vi.fn().mockResolvedValue(overrides.job ?? KEPT_JOB) },
      connection: {
        findFirst: vi
          .fn()
          .mockResolvedValue(
            "connection" in overrides
              ? overrides.connection
              : { credentials: "enc", externalAccountId: "act_1" },
          ),
      },
    },
    decrypt: vi
      .fn()
      .mockReturnValue(
        overrides.creds ?? { accessToken: "tok", accountId: "act_1", pageId: "page_1" },
      ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("assertPublishable", () => {
  it("returns ok with resolved context for a complete, kept job with conn + page", async () => {
    const r = await assertPublishable(deps(), "org_1", "j1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pageId).toBe("page_1");
      expect(r.accessToken).toBe("tok");
      expect(r.durableAssetUrl).toBe("https://cdn.example/a.mp4");
    }
  });

  it("CREATIVE_JOB_NOT_FOUND for a missing job", async () => {
    const r = await assertPublishable(deps({ job: null }), "org_1", "j1");
    expect(r).toMatchObject({ ok: false, code: "CREATIVE_JOB_NOT_FOUND" });
  });

  it("CREATIVE_JOB_NOT_FOUND for a cross-org job", async () => {
    const r = await assertPublishable(
      deps({ job: { ...KEPT_JOB, organizationId: "other" } }),
      "org_1",
      "j1",
    );
    expect(r).toMatchObject({ ok: false, code: "CREATIVE_JOB_NOT_FOUND" });
  });

  it("CREATIVE_NOT_PUBLISHABLE when not complete", async () => {
    const r = await assertPublishable(
      deps({ job: { ...KEPT_JOB, currentStage: "storyboard" } }),
      "org_1",
      "j1",
    );
    expect(r).toMatchObject({ ok: false, code: "CREATIVE_NOT_PUBLISHABLE" });
  });

  it("CREATIVE_NOT_PUBLISHABLE when not human-kept", async () => {
    const r = await assertPublishable(
      deps({ job: { ...KEPT_JOB, reviewDecision: null } }),
      "org_1",
      "j1",
    );
    expect(r).toMatchObject({ ok: false, code: "CREATIVE_NOT_PUBLISHABLE" });
  });

  it("CREATIVE_ASSET_NOT_DURABLE when durableAssetUrl is null", async () => {
    const r = await assertPublishable(
      deps({ job: { ...KEPT_JOB, durableAssetUrl: null } }),
      "org_1",
      "j1",
    );
    expect(r).toMatchObject({ ok: false, code: "CREATIVE_ASSET_NOT_DURABLE" });
  });

  it("META_CONNECTION_NOT_FOUND when no meta-ads connection", async () => {
    const r = await assertPublishable(deps({ connection: null }), "org_1", "j1");
    expect(r).toMatchObject({ ok: false, code: "META_CONNECTION_NOT_FOUND" });
  });

  it("META_CONNECTION_NOT_FOUND when creds lack token/account", async () => {
    const r = await assertPublishable(deps({ creds: { pageId: "page_1" } }), "org_1", "j1");
    expect(r).toMatchObject({ ok: false, code: "META_CONNECTION_NOT_FOUND" });
  });

  it("META_PAGE_NOT_CONFIGURED when no pageId resolvable", async () => {
    const r = await assertPublishable(
      deps({ creds: { accessToken: "tok", accountId: "act_1" } }),
      "org_1",
      "j1",
    );
    expect(r).toMatchObject({ ok: false, code: "META_PAGE_NOT_CONFIGURED" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/api test -- creative-publish-preconditions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/services/creative-publish-preconditions.ts`:

```ts
import type { PrismaClient, CreativeJob } from "@switchboard/db";

export type PublishFailureCode =
  | "CREATIVE_JOB_NOT_FOUND"
  | "CREATIVE_NOT_PUBLISHABLE"
  | "CREATIVE_ASSET_NOT_DURABLE"
  | "META_CONNECTION_NOT_FOUND"
  | "META_PAGE_NOT_CONFIGURED";

export interface PublishContext {
  ok: true;
  job: CreativeJob;
  durableAssetUrl: string;
  accessToken: string;
  accountId: string;
  pageId: string;
}

export interface PublishPrecheckFailure {
  ok: false;
  code: PublishFailureCode;
  message: string;
}

export type PublishPrecheck = PublishContext | PublishPrecheckFailure;

export interface AssertPublishableDeps {
  prisma: PrismaClient;
  decrypt: (encrypted: unknown) => Record<string, unknown>;
}

const META_ADS_SERVICE_ID = "meta-ads";

function fail(code: PublishFailureCode, message: string): PublishPrecheckFailure {
  return { ok: false, code, message };
}

/**
 * Single source of truth for "can this job be published as a paused Meta draft?".
 * Used by the route (pre-flight → immediate 4xx) AND the workflow handler
 * (defensive re-check post-approval). Fails loud with an actionable code; never
 * silently no-ops. Page-id read side only — the operator setter is PR C.
 */
export async function assertPublishable(
  deps: AssertPublishableDeps,
  organizationId: string,
  jobId: string,
): Promise<PublishPrecheck> {
  const job = (await deps.prisma.creativeJob.findUnique({
    where: { id: jobId },
  })) as unknown as CreativeJob | null;

  if (!job || job.organizationId !== organizationId) {
    return fail("CREATIVE_JOB_NOT_FOUND", "Creative job not found for this organization.");
  }

  const isComplete = job.currentStage === "complete" && !job.stoppedAt;
  const isKept = job.reviewDecision === "kept";
  if (!isComplete || !isKept) {
    return fail(
      "CREATIVE_NOT_PUBLISHABLE",
      "Only a completed creative you have kept can be published as a paused draft.",
    );
  }

  if (!job.durableAssetUrl) {
    return fail(
      "CREATIVE_ASSET_NOT_DURABLE",
      "The rendered creative has no durable asset yet (pending durable storage).",
    );
  }

  const connection = (await deps.prisma.connection.findFirst({
    where: { serviceId: META_ADS_SERVICE_ID, organizationId },
    select: { credentials: true, externalAccountId: true },
  })) as { credentials: unknown; externalAccountId: string | null } | null;

  if (!connection) {
    return fail("META_CONNECTION_NOT_FOUND", "No Meta Ads connection for this organization.");
  }

  const creds = deps.decrypt(connection.credentials);
  const accessToken = typeof creds["accessToken"] === "string" ? creds["accessToken"] : null;
  const accountId =
    typeof creds["accountId"] === "string"
      ? creds["accountId"]
      : (connection.externalAccountId ?? null);
  if (!accessToken || !accountId) {
    return fail(
      "META_CONNECTION_NOT_FOUND",
      "Meta Ads connection is missing an access token or ad account id.",
    );
  }

  // Page-id resolution (read-only; setter is PR C): connection credentials first.
  const pageId = typeof creds["pageId"] === "string" ? creds["pageId"] : null;
  if (!pageId) {
    return fail(
      "META_PAGE_NOT_CONFIGURED",
      "No Facebook Page is configured for ads on this connection.",
    );
  }

  return { ok: true, job, durableAssetUrl: job.durableAssetUrl, accessToken, accountId, pageId };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/api test -- creative-publish-preconditions`
Expected: PASS (all 9).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/creative-publish-preconditions.ts apps/api/src/services/__tests__/creative-publish-preconditions.test.ts
git commit -m "feat(api): add assertPublishable pre-flight for creative publish"
```

---

## Task 8: `buildCreativePublishWorkflow` handler (idempotent/resumable)

**Files:**

- Create: `apps/api/src/services/workflows/creative-publish-workflow.ts`
- Test: `apps/api/src/services/workflows/__tests__/creative-publish-workflow.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/workflows/__tests__/creative-publish-workflow.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildCreativePublishWorkflow } from "../creative-publish-workflow.js";

const ORG = "org_1";
const JOB_BASE = {
  id: "j1",
  organizationId: ORG,
  productDescription: "Botox refresh",
  currentStage: "complete",
  stoppedAt: null,
  reviewDecision: "kept",
  durableAssetUrl: "https://cdn.example/a.mp4",
  metaVideoId: null,
  metaCampaignId: null,
  metaAdSetId: null,
  metaCreativeId: null,
  metaAdId: null,
  metaPublishStatus: null,
};

function workUnit() {
  return { organizationId: ORG, parameters: { jobId: "j1" } } as never;
}

function makeAds() {
  return {
    uploadCreativeAsset: vi.fn().mockResolvedValue({ id: "vid_1", url: "u" }),
    createDraftCampaign: vi.fn().mockResolvedValue({ id: "camp_1" }),
    createDraftAdSet: vi.fn().mockResolvedValue({ id: "set_1" }),
    createAdCreative: vi.fn().mockResolvedValue({ id: "cr_1" }),
    createAd: vi.fn().mockResolvedValue({ id: "ad_1" }),
    updateCampaignStatus: vi.fn(),
  };
}

/** Mutable job store that mirrors findById/updatePublishFields against an in-memory row. */
function makeStore(initial: Record<string, unknown>) {
  let row = { ...initial };
  return {
    findById: vi.fn(async () => ({ ...row })),
    updatePublishFields: vi.fn(
      async (_org: string, _id: string, fields: Record<string, unknown>) => {
        row = { ...row, ...fields };
        return { ...row };
      },
    ),
    _row: () => row,
  };
}

function deps(
  over: {
    ads?: ReturnType<typeof makeAds>;
    store?: ReturnType<typeof makeStore>;
    pre?: unknown;
  } = {},
) {
  const ads = over.ads ?? makeAds();
  const store = over.store ?? makeStore(JOB_BASE);
  return {
    ads,
    store,
    handler: buildCreativePublishWorkflow({
      jobStore: store as never,
      assertPublishable: vi.fn().mockResolvedValue(
        over.pre ?? {
          ok: true,
          job: store._row(),
          durableAssetUrl: "https://cdn.example/a.mp4",
          accessToken: "tok",
          accountId: "act_1",
          pageId: "page_1",
        },
      ),
      makeAdsClient: () => ads as never,
      fetchAsset: vi.fn().mockResolvedValue({ buffer: Buffer.from("x"), type: "video" }),
    }),
  };
}

describe("buildCreativePublishWorkflow", () => {
  it("creates the full paused draft package and persists all meta ids", async () => {
    const { handler, ads, store } = deps();
    const res = await handler.execute(workUnit());

    expect(res.outcome).toBe("completed");
    expect(res.summary.toLowerCase()).toContain("paused draft");
    // every Meta create ran exactly once
    expect(ads.uploadCreativeAsset).toHaveBeenCalledTimes(1);
    expect(ads.createDraftCampaign).toHaveBeenCalledTimes(1);
    expect(ads.createDraftAdSet).toHaveBeenCalledTimes(1);
    expect(ads.createAdCreative).toHaveBeenCalledTimes(1);
    expect(ads.createAd).toHaveBeenCalledTimes(1);
    // paused-only
    expect(ads.createDraftCampaign.mock.calls[0][0].budget).toBeDefined();
    // never activates
    expect(ads.updateCampaignStatus).not.toHaveBeenCalled();
    // persisted
    expect(store._row().metaAdId).toBe("ad_1");
    expect(store._row().metaPublishStatus).toBe("parked_paused");
  });

  it("short-circuits a fully-parked job with zero Meta calls", async () => {
    const store = makeStore({ ...JOB_BASE, metaAdId: "ad_1", metaPublishStatus: "parked_paused" });
    const { handler, ads } = deps({ store });
    const res = await handler.execute(workUnit());
    expect(res.outcome).toBe("completed");
    expect(ads.uploadCreativeAsset).not.toHaveBeenCalled();
    expect(ads.createAd).not.toHaveBeenCalled();
  });

  it("resumes a partial job: reuses the existing campaign, no duplicate", async () => {
    const store = makeStore({ ...JOB_BASE, metaVideoId: "vid_1", metaCampaignId: "camp_1" });
    const { handler, ads } = deps({ store });
    const res = await handler.execute(workUnit());
    expect(res.outcome).toBe("completed");
    expect(ads.uploadCreativeAsset).not.toHaveBeenCalled(); // metaVideoId present
    expect(ads.createDraftCampaign).not.toHaveBeenCalled(); // metaCampaignId present
    expect(ads.createDraftAdSet).toHaveBeenCalledTimes(1);
    expect(ads.createAd).toHaveBeenCalledTimes(1);
  });

  it("returns CREATIVE_PUBLISH_META_ERROR when a Meta call fails (checkpoints persisted)", async () => {
    const ads = makeAds();
    ads.createDraftAdSet.mockRejectedValueOnce(new Error("Meta API error (400): bad targeting"));
    const store = makeStore(JOB_BASE);
    const { handler } = deps({ ads, store });
    const res = await handler.execute(workUnit());
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("CREATIVE_PUBLISH_META_ERROR");
    // checkpoints up to the failure were persisted (resume-safe)
    expect(store._row().metaVideoId).toBe("vid_1");
    expect(store._row().metaCampaignId).toBe("camp_1");
    expect(store._row().metaAdSetId).toBeNull();
  });

  it("returns the precheck failure code defensively (no Meta calls)", async () => {
    const ads = makeAds();
    const { handler } = deps({
      ads,
      pre: { ok: false, code: "CREATIVE_ASSET_NOT_DURABLE", message: "x" },
    });
    const res = await handler.execute(workUnit());
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("CREATIVE_ASSET_NOT_DURABLE");
    expect(ads.createAd).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/api test -- creative-publish-workflow`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `apps/api/src/services/workflows/creative-publish-workflow.ts`:

```ts
import type { WorkflowHandler } from "@switchboard/core/platform";
import type { MetaAdsClient } from "@switchboard/ad-optimizer";
import type { CreativeJob } from "@switchboard/schemas";
import type { PrismaCreativeJobStore } from "@switchboard/db";
import type { PublishPrecheck } from "../creative-publish-preconditions.js";

/** The subset of MetaAdsClient the publish chain uses (so tests can inject a mock). */
export type AdsClientLike = Pick<
  MetaAdsClient,
  | "uploadCreativeAsset"
  | "createDraftCampaign"
  | "createDraftAdSet"
  | "createAdCreative"
  | "createAd"
>;

export interface CreativePublishDeps {
  jobStore: Pick<PrismaCreativeJobStore, "findById" | "updatePublishFields">;
  assertPublishable: (organizationId: string, jobId: string) => Promise<PublishPrecheck>;
  makeAdsClient: (cfg: { accessToken: string; accountId: string }) => AdsClientLike;
  fetchAsset: (url: string) => Promise<{ buffer: Buffer; type: "image" | "video" }>;
}

const PARKED_PAUSED = "parked_paused";
const PAUSED_DRAFT_SUMMARY = "Created paused Meta draft package (review & activate in Ads Manager)";

// Placeholder ad content — the operator finalizes ALL of this in Ads Manager before
// activation (the locked "parked draft" framing). Single-sourced here; resolving
// real values (booking link, targeting, copy, currency-aware budget) is go-live
// hardening (spec §11). The campaign is PAUSED so the budget never spends.
const MIN_VALID_PAUSED_DAILY_BUDGET_MINOR_UNITS = 500; // ~5 units of account currency
const DRAFT_OBJECTIVE = "OUTCOME_LEADS";
const DRAFT_BID_STRATEGY = "LOWEST_COST_WITHOUT_CAP";
const DRAFT_OPTIMIZATION_GOAL = "LEAD_GENERATION";
const DRAFT_TARGETING: Record<string, unknown> = { geo_locations: { countries: ["SG"] } };
const DRAFT_CTA = "LEARN_MORE";
const DRAFT_LINK_PLACEHOLDER = "https://switchboard.example/finalize-in-ads-manager";

function draftName(job: CreativeJob): string {
  return `Mira draft — ${job.productDescription.slice(0, 40)} — ${job.id}`;
}

/**
 * Governed `creative.job.publish` handler. Runs ONLY after mandatory human approval
 * (the seeded require_approval policy). Idempotent and resumable: each created Meta
 * object id is persisted as a checkpoint, and a retry reuses any id already present
 * (no orphaned/duplicate paused objects). Activation is unreachable — createAd is
 * PAUSED-only and updateCampaignStatus is never called.
 */
export function buildCreativePublishWorkflow(deps: CreativePublishDeps): WorkflowHandler {
  return {
    async execute(workUnit) {
      const { jobId } = workUnit.parameters as { jobId: string };
      const orgId = workUnit.organizationId;

      let job = await deps.jobStore.findById(jobId);
      if (!job || job.organizationId !== orgId) {
        return {
          outcome: "failed",
          summary: "Creative job not found",
          error: { code: "CREATIVE_JOB_NOT_FOUND", message: "Creative job not found" },
        };
      }

      // Idempotent short-circuit: already a parked draft.
      if (job.metaPublishStatus === PARKED_PAUSED && job.metaAdId) {
        return {
          outcome: "completed",
          summary: PAUSED_DRAFT_SUMMARY,
          outputs: {
            metaAdId: job.metaAdId,
            metaAdSetId: job.metaAdSetId,
            metaCreativeId: job.metaCreativeId,
            metaCampaignId: job.metaCampaignId,
          },
        };
      }

      // Defensive re-check (state may have changed between submit and approval).
      const pre = await deps.assertPublishable(orgId, jobId);
      if (!pre.ok) {
        return {
          outcome: "failed",
          summary: "Creative is not publishable",
          error: { code: pre.code, message: pre.message },
        };
      }

      const ads = deps.makeAdsClient({ accessToken: pre.accessToken, accountId: pre.accountId });

      try {
        const asset = await deps.fetchAsset(pre.durableAssetUrl);

        if (!job.metaVideoId) {
          const v = await ads.uploadCreativeAsset({ file: asset.buffer, type: asset.type });
          job = await deps.jobStore.updatePublishFields(orgId, jobId, { metaVideoId: v.id });
        }
        if (!job.metaCampaignId) {
          const c = await ads.createDraftCampaign({
            name: draftName(job),
            objective: DRAFT_OBJECTIVE,
            budget: { daily: MIN_VALID_PAUSED_DAILY_BUDGET_MINOR_UNITS },
            bidStrategy: DRAFT_BID_STRATEGY,
          });
          job = await deps.jobStore.updatePublishFields(orgId, jobId, { metaCampaignId: c.id });
        }
        if (!job.metaAdSetId) {
          const s = await ads.createDraftAdSet({
            campaignId: job.metaCampaignId as string,
            name: draftName(job),
            targeting: DRAFT_TARGETING,
            optimizationGoal: DRAFT_OPTIMIZATION_GOAL,
          });
          job = await deps.jobStore.updatePublishFields(orgId, jobId, { metaAdSetId: s.id });
        }
        if (!job.metaCreativeId) {
          const cr = await ads.createAdCreative({
            name: draftName(job),
            pageId: pre.pageId,
            videoId: job.metaVideoId as string,
            message: job.productDescription,
            linkUrl: DRAFT_LINK_PLACEHOLDER,
            callToActionType: DRAFT_CTA,
          });
          job = await deps.jobStore.updatePublishFields(orgId, jobId, { metaCreativeId: cr.id });
        }
        if (!job.metaAdId) {
          const a = await ads.createAd({
            name: draftName(job),
            adSetId: job.metaAdSetId as string,
            creativeId: job.metaCreativeId as string,
          });
          job = await deps.jobStore.updatePublishFields(orgId, jobId, {
            metaAdId: a.id,
            metaPublishStatus: PARKED_PAUSED,
          });
        }
      } catch (err) {
        return {
          outcome: "failed",
          summary: "Meta draft creation failed",
          error: {
            code: "CREATIVE_PUBLISH_META_ERROR",
            message: err instanceof Error ? err.message : "Unknown Meta error",
          },
        };
      }

      return {
        outcome: "completed",
        summary: PAUSED_DRAFT_SUMMARY,
        outputs: {
          metaAdId: job.metaAdId,
          metaAdSetId: job.metaAdSetId,
          metaCreativeId: job.metaCreativeId,
          metaCampaignId: job.metaCampaignId,
        },
      };
    },
  };
}
```

(If `fetchAsset` rejection should be distinguishable from a Meta-call error, note it is currently folded into the same `try` and surfaces as `CREATIVE_PUBLISH_META_ERROR`; that is acceptable for PR B — both are "could not build the draft" and resume-safe. The test does not assert fetch-failure separately.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/api test -- creative-publish-workflow`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/workflows/creative-publish-workflow.ts apps/api/src/services/workflows/__tests__/creative-publish-workflow.test.ts
git commit -m "feat(api): add idempotent creative.job.publish workflow handler"
```

---

## Task 9: Register the intent + handler + deps

**Files:**

- Modify: `apps/api/src/bootstrap/contained-workflows.ts` (handlers Map, workflowIntents array, deps wiring)

- [ ] **Step 1: Add the dynamic import**

Near the other `await import(...)` handler imports at the top of `bootstrapContainedWorkflows`:

```ts
const { buildCreativePublishWorkflow } =
  await import("../services/workflows/creative-publish-workflow.js");
const { assertPublishable } = await import("../services/creative-publish-preconditions.js");
const { MetaAdsClient } = await import("@switchboard/ad-optimizer");
const { decryptCredentials } = await import("@switchboard/db");
```

- [ ] **Step 2: Build the publish handler deps + register it in the handlers Map**

Where `PrismaCreativeJobStore` is already imported from `@switchboard/db` in this function, add (before the `handlers` Map):

```ts
const prismaForPublish = prismaClient as import("@switchboard/db").PrismaClient;
const publishJobStore = new PrismaCreativeJobStore(prismaForPublish);
const creativePublishWorkflow = buildCreativePublishWorkflow({
  jobStore: publishJobStore,
  assertPublishable: (organizationId, jobId) =>
    assertPublishable(
      { prisma: prismaForPublish, decrypt: decryptCredentials },
      organizationId,
      jobId,
    ),
  makeAdsClient: (cfg) => new MetaAdsClient(cfg),
  fetchAsset: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`asset fetch failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const type = (res.headers.get("content-type") ?? "").startsWith("image/")
      ? ("image" as const)
      : ("video" as const);
    return { buffer, type };
  },
});
```

Add to the `handlers` Map literal (next to the other `creative.job.*` entries):

```ts
    ["creative.job.publish", creativePublishWorkflow],
```

(Note `decryptCredentials(string)` — `Connection.credentials` is stored as the base64 string from `encryptCredentials`, so passing `connection.credentials` through works; see `ads-client-factory.ts`. If TS complains about the `unknown` arg, wrap: `decrypt: (e) => decryptCredentials(e as string)`.)

- [ ] **Step 3: Register the intent in the workflowIntents array**

Add an entry to the `workflowIntents` array:

```ts
    {
      // Publish a kept creative as a self-contained PAUSED Meta draft package.
      // approvalPolicy is DECORATIVE (the policy engine never reads it) — the real
      // claim-safety gate is the seeded org-scoped require_approval(mandatory)
      // policy for `creative.job.publish` (see creative-governance.ts). We keep
      // "always" here only as documented intent + the safe value if anything ever
      // reads it. Spend-bearing/publish targets do NOT use system_auto_approved.
      intent: "creative.job.publish",
      workflowId: "creative.job.publish",
      budgetClass: "standard",
      approvalPolicy: "always",
      allowedTriggers: ["api"],
    },
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS (no type errors). This task's behavior is verified by Tasks 10 & 11.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/contained-workflows.ts
git commit -m "feat(api): register creative.job.publish intent + handler"
```

---

## Task 10: Route `POST /creative-jobs/:id/publish`

**Files:**

- Modify: `apps/api/src/routes/creative-pipeline.ts`
- Test: `apps/api/src/routes/__tests__/creative-pipeline.test.ts` (or the existing route test file for this router; reuse its app-build helper)

- [ ] **Step 1: Write the failing tests**

Append to the creative-pipeline route test (mirror the file's existing Fastify-app + auth-header setup; the assertions are the contract):

```ts
it("POST /creative-jobs/:id/publish returns 202 PENDING_APPROVAL when the gate parks", async () => {
  // assertPublishable resolves; platformIngress.submit returns the approval-required variant.
  submitMock.mockResolvedValueOnce({
    ok: true,
    result: { outcome: "pending_approval", outputs: {} },
    workUnit: { id: "wu_1", traceId: "tr_1" },
    approvalRequired: true,
    lifecycleId: "lc_1",
    bindingHash: "bh_1",
  });
  const res = await app.inject({
    method: "POST",
    url: "/creative-jobs/j1/publish",
    headers: { "x-org-id": "org_1", "x-principal-id": "user_1" },
  });
  expect(res.statusCode).toBe(202);
  expect(res.json()).toMatchObject({ outcome: "PENDING_APPROVAL", workUnitId: "wu_1" });
});

it("POST /creative-jobs/:id/publish returns 422 when the asset is not durable", async () => {
  // job exists/kept but durableAssetUrl null → CREATIVE_ASSET_NOT_DURABLE
  jobRow = { ...KEPT_ROW, durableAssetUrl: null };
  const res = await app.inject({
    method: "POST",
    url: "/creative-jobs/j1/publish",
    headers: { "x-org-id": "org_1", "x-principal-id": "user_1" },
  });
  expect(res.statusCode).toBe(422);
  expect(res.json().code).toBe("CREATIVE_ASSET_NOT_DURABLE");
  expect(submitMock).not.toHaveBeenCalled();
});

it("POST /creative-jobs/:id/publish returns 404 for a missing/cross-org job", async () => {
  jobRow = null;
  const res = await app.inject({
    method: "POST",
    url: "/creative-jobs/j1/publish",
    headers: { "x-org-id": "org_1", "x-principal-id": "user_1" },
  });
  expect(res.statusCode).toBe(404);
  expect(res.json().code).toBe("CREATIVE_JOB_NOT_FOUND");
});
```

(Wire the test's `app.prisma` mock so `creativeJob.findUnique` returns `jobRow` and `connection.findFirst` returns a meta-ads connection with decryptable `{accessToken, accountId, pageId}`. `KEPT_ROW` mirrors Task 7's `KEPT_JOB`. `submitMock` is `app.platformIngress.submit`. If the existing route test already builds an app with a real-ish prisma/ingress, extend that harness rather than introducing new mocks.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/api test -- creative-pipeline`
Expected: FAIL — route 404 (not registered).

- [ ] **Step 3: Implement the route**

In `apps/api/src/routes/creative-pipeline.ts`, add the import:

```ts
import { decryptCredentials } from "@switchboard/db";
import { assertPublishable } from "../services/creative-publish-preconditions.js";
```

Add a helper near `pendingApprovalReply` to map precheck codes to HTTP statuses:

```ts
const PUBLISH_FAILURE_STATUS: Record<string, number> = {
  CREATIVE_JOB_NOT_FOUND: 404,
  CREATIVE_NOT_PUBLISHABLE: 409,
  CREATIVE_ASSET_NOT_DURABLE: 422,
  META_CONNECTION_NOT_FOUND: 422,
  META_PAGE_NOT_CONFIGURED: 422,
};
```

Add the route inside the plugin (after the `/creative-jobs/:id/approve` route):

```ts
// POST /creative-jobs/:id/publish — create a self-contained PAUSED Meta draft
// package for a kept creative. Pre-flights (immediate 4xx so we never park a
// doomed publish), then submits the governed `creative.job.publish` intent. The
// seeded require_approval(mandatory) policy ALWAYS parks it → 202 is the happy
// path (mirrors the sibling routes; reuses pendingApprovalReply). This creates a
// paused DRAFT only; activation is a human action in Ads Manager.
app.post(
  "/creative-jobs/:id/publish",
  { preHandler: requireOrgForMutation },
  async (request, reply) => {
    if (!app.platformIngress || !app.prisma) {
      return reply.code(503).send({ error: "Platform not available", statusCode: 503 });
    }
    const { id } = request.params as { id: string };

    const pre = await assertPublishable(
      { prisma: app.prisma, decrypt: (e) => decryptCredentials(e as string) },
      request.orgId,
      id,
    );
    if (!pre.ok) {
      return reply
        .code(PUBLISH_FAILURE_STATUS[pre.code] ?? 422)
        .send({
          code: pre.code,
          error: pre.message,
          statusCode: PUBLISH_FAILURE_STATUS[pre.code] ?? 422,
        });
    }

    const response = await app.platformIngress.submit({
      intent: "creative.job.publish",
      parameters: { jobId: id },
      actor: { id: request.actorId, type: "user" },
      organizationId: request.orgId,
      trigger: "api",
      surface: { surface: "api" },
    });

    if (!response.ok) {
      return ingressErrorToReply(response.error, reply);
    }
    if ("approvalRequired" in response && response.approvalRequired) {
      return pendingApprovalReply(response, reply);
    }
    if (response.result.outcome === "failed") {
      // Publish only runs post-approval; a failed outcome here is a genuine
      // handler failure (e.g. CREATIVE_PUBLISH_META_ERROR). Surface its code.
      const err = response.result.error;
      return reply.code(422).send({
        code: err?.code ?? "CREATIVE_PUBLISH_FAILED",
        error: err?.message ?? "Publish failed",
        statusCode: 422,
      });
    }
    // The mandatory policy means we should always have parked above; treat a
    // straight-through success defensively as a completed parked draft.
    return reply.code(202).send({ outcome: "PENDING_APPROVAL", ...response.result.outputs });
  },
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/api test -- creative-pipeline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/creative-pipeline.ts apps/api/src/routes/__tests__/creative-pipeline.test.ts
git commit -m "feat(api): add POST /creative-jobs/:id/publish route (pre-flight + 202)"
```

---

## Task 11: Real-`GovernanceGate` safety proofs

**Files:**

- Create: `apps/api/src/__tests__/creative-publish-gate.test.ts` (mirror `creative-spend-gate.test.ts`)

- [ ] **Step 1: Write the tests**

Create `apps/api/src/__tests__/creative-publish-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GovernanceGate, type GovernanceGateDeps } from "@switchboard/core/platform";
import type { WorkUnit, IntentRegistration } from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import { extractSpendAmount } from "@switchboard/core";
import {
  CREATIVE_ALLOW_POLICY_RULE,
  buildCreativePublishApprovalPolicyInput,
} from "@switchboard/db";

const ORG = "org-acme";
const ACTOR = "user-zoe";

function operatorSpec(): IdentitySpec {
  return {
    id: "spec-zoe",
    principalId: ACTOR,
    organizationId: ORG,
    name: "Operator",
    description: "Plain operator identity",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: null, weekly: null, monthly: null, perAction: null },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function allowPolicy(): Policy {
  return {
    id: "policy_allow_creative",
    name: "Allow creative pipeline actions",
    description: "allow",
    organizationId: ORG,
    cartridgeId: null,
    priority: 50,
    active: true,
    rule: CREATIVE_ALLOW_POLICY_RULE,
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function publishApprovalPolicy(): Policy {
  const p = buildCreativePublishApprovalPolicyInput(ORG);
  return {
    ...p,
    cartridgeId: null,
    effect: "require_approval",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

function publishRegistration(): IntentRegistration {
  return {
    intent: "creative.job.publish",
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: "creative.job.publish" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "standard",
    approvalPolicy: "always",
    idempotent: false,
    allowedTriggers: ["api"],
    timeoutMs: 300_000,
    retryable: true,
  };
}

function workUnit(): WorkUnit {
  return {
    id: "wu-pub-1",
    requestedAt: "2026-06-02T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: ACTOR, type: "user" },
    intent: "creative.job.publish",
    parameters: { jobId: "j1" },
    deployment: {
      deploymentId: "dep-creative",
      skillSlug: "creative",
      trustLevel: "guided",
      trustScore: 0,
      trustLevelOverride: "autonomous",
      spendAutonomyEnabled: true,
      policyOverrides: { spendApprovalThreshold: 15 },
    },
    resolvedMode: "workflow",
    traceId: "trace-pub-1",
    trigger: "api",
    priority: "normal",
  };
}

function buildGate(policies: Policy[]): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => policies,
    loadIdentitySpec: async () => ({ spec: operatorSpec(), overlays: [] }),
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}

describe("creative.job.publish governance gate", () => {
  it("parks at MANDATORY with the seeded allow + require_approval policies", async () => {
    const gate = buildGate([allowPolicy(), publishApprovalPolicy()]);
    const decision = await gate.evaluate(workUnit(), publishRegistration());
    expect(decision.outcome).toBe("require_approval");
    if (decision.outcome === "require_approval") {
      expect(decision.approvalLevel).toBe("mandatory");
    }
  });

  it("default-DENIES on an un-seeded org (no allow policy) — fail safe", async () => {
    const gate = buildGate([]);
    const decision = await gate.evaluate(workUnit(), publishRegistration());
    expect(decision.outcome).toBe("deny");
  });

  it("the $0-spend lever cannot downgrade it: publish params carry no SPEND_KEYS", () => {
    expect(
      extractSpendAmount({
        actionType: "creative.job.publish",
        parameters: { jobId: "j1" },
      } as never),
    ).toBeNull();
  });

  it("the mandatory publish policy does NOT elevate creative.job.continue", async () => {
    // continue under the same seeded policies stays governed by the spend threshold,
    // NOT forced to mandatory (the publish rule is anchored to creative.job.publish).
    const gate = buildGate([allowPolicy(), publishApprovalPolicy()]);
    const continueWu = {
      ...workUnit(),
      intent: "creative.job.continue",
      parameters: { jobId: "j1", productionTier: "basic", spendAmount: 1 },
    };
    const continueReg = {
      ...publishRegistration(),
      intent: "creative.job.continue",
      approvalPolicy: "threshold" as const,
      executor: { mode: "workflow" as const, workflowId: "creative.job.continue" },
    };
    const decision = await gate.evaluate(continueWu as never, continueReg);
    // small spend under autonomous+threshold → executes (not forced to mandatory by the publish policy)
    expect(decision.outcome).toBe("execute");
  });
});
```

(If `extractSpendAmount` is not exported from `@switchboard/core`, import it from `@switchboard/core/...` per its barrel — confirm the export path; it lives at `packages/core/src/engine/spend-limits.ts`. If the `Policy`/`IdentitySpec` field shapes differ from this fixture, copy the exact shapes from `creative-spend-gate.test.ts`, which is the canonical mirror.)

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @switchboard/api test -- creative-publish-gate`
Expected: PASS — parks at mandatory; un-seeded denies; extractSpendAmount null; continue still executes (publish policy doesn't bleed).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/creative-publish-gate.test.ts
git commit -m "test(api): prove creative.job.publish parks at mandatory + spend-lever no-op"
```

---

## Task 12: Full verification + drift

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: PASS. If it reports missing exports from `@switchboard/*` or unknown Prisma fields, run `pnpm reset` first (stale dist), then re-run.

- [ ] **Step 2: Run the affected suites**

Run: `pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/db test && pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/api test`
Expected: all PASS.

- [ ] **Step 3: Lint + format + route-ingress check**

Run: `pnpm lint && pnpm format:check`
Run: `node .agent/tools/check-routes` (or `pnpm` script that runs it) — confirm the new route passes (creative-pipeline.ts is already allowlisted + `lifecycle`-classed; no new violation).
Expected: PASS. If format:check fails, run `pnpm format` and re-stage.

- [ ] **Step 4: Schema drift**

Run (only if Postgres is reachable): `pnpm db:check-drift`
Expected: no drift (the hand-written migration matches the schema). If Postgres is unreachable locally, note that CI validates drift; ensure the migration SQL exactly matches the 7 added columns.

- [ ] **Step 5: Final commit (if any fixes)**

```bash
git add -A
git commit -m "chore(mira): publish seam — lint/format/typecheck fixes"
```

---

## Self-review checklist (completed during planning)

- **Spec coverage:** §4.1 decorative `approvalPolicy` → Task 9 comment + Task 11 test; §4.2 mandatory policy → Tasks 4/5/11; §4.3 activation-unreachable → Task 3 (PAUSED-only `createAd` + ACTIVE-guard lock) + Task 8 (no `updateCampaignStatus`); §4.4 two-gate → Task 7 (kept) + Task 11 (mandatory); §4.5 copy → Task 8 summary + Task 10/route + Task 8 test `toContain("paused draft")`; §6.1 methods → Tasks 2/3; §6.2 schema → Task 1; §6.3 eligibility → Task 7; §6.4 assertPublishable → Task 7; §6.5 route+202 → Task 10; §6.6 idempotent handler + budget → Task 8; §6.7 seed → Task 5; §8 tests → Tasks across; idempotency/resume (§8.11) → Task 8; spend no-op (§8.3) → Task 11.
- **Type consistency:** `assertPublishable(deps, org, job)` standalone vs the handler's injected `assertPublishable(org, job)` — the bootstrap (Task 9) binds `deps` into the 2-arg form the handler expects; the route (Task 10) calls the 3-arg form directly. `PublishPrecheck`/`PublishFailureCode` names match across Tasks 7/8/10. `updatePublishFields` signature matches Tasks 6/8. `metaPublishStatus === "parked_paused"` consistent (Tasks 1/8/11).
- **Known go-live gaps (not PR B):** PR A (`durableAssetUrl` producer), PR C (Page-id setter), async/dead-letter Inngest move, real ad-content + currency-aware budget. All in spec §11; the handler fails loud until they land.
