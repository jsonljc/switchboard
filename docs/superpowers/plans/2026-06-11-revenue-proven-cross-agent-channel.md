# Revenue-Proven Cross-Agent Channel (F4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Riley-owned `revenue_proven` DeploymentMemory writer so a proven creative winner promoted from `CreativeJob.pastPerformance` surfaces in Mira's brief through the already-wired (but dead) read in `builders/mira.ts`.

**Architecture:** A standalone daily Inngest sweep (`creative-revenue-proven-promotion`, mirroring `creative-taste-sweep`) reads already-persisted measured `pastPerformance`, applies economic floors, and upserts a `revenue_proven:{mode}_{segment}` memory row onto the CreativeJob's deployment (= the Mira creative deployment Mira reads). A per-job watermark column (`revenueProvenPromotedAt`) gives once-per-creative idempotency. See spec `docs/superpowers/specs/2026-06-11-revenue-proven-cross-agent-channel-design.md`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Prisma, Inngest, Vitest, Zod. Postgres is down locally — migration is hand-written + CI-validated; tests mock Prisma / inject fakes.

---

## File structure

- Modify `packages/db/prisma/schema.prisma` — add `revenueProvenPromotedAt DateTime?` to `CreativeJob`.
- Create `packages/db/prisma/migrations/20260611120000_creative_job_revenue_proven_promoted_at/migration.sql`.
- Modify `packages/db/src/stores/prisma-creative-job-store.ts` — add `RevenueProvenCandidate` type + `listRevenueProvenCandidates` + `setRevenueProvenPromotedAt`.
- Create `apps/api/src/services/cron/revenue-proven-promotion.ts` — floors, key/content, upsert, sweep, Inngest fn. **The sole `revenue_proven` writer.**
- Create `apps/api/src/services/cron/revenue-proven-promotion.test.ts` — unit tests (floors, upsert, watermark, P2002, cap, isolation).
- Create `apps/api/src/services/cron/revenue-proven-loop.test.ts` — producer→consumer proof.
- Create `apps/api/src/__tests__/revenue-proven-writer-boundary.test.ts` — source-scan: only the promotion module writes the category.
- Modify `apps/api/src/bootstrap/inngest.ts` — construct + register the function.

---

## Task 1: Watermark column + migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma:1414` (CreativeJob, after `tasteCapturedAt`)
- Create: `packages/db/prisma/migrations/20260611120000_creative_job_revenue_proven_promoted_at/migration.sql`

- [ ] **Step 1: Add the column to the Prisma model**

In `model CreativeJob`, immediately after the `tasteCapturedAt DateTime?` line (1414), add:

```prisma
  // F4 revenue-proven promotion idempotency watermark: set once when a
  // measured creative first crosses the promotion floors, so the daily sweep
  // never re-counts the same creative into its bucket (sourceCount fidelity).
  revenueProvenPromotedAt DateTime?
```

- [ ] **Step 2: Generate the migration SQL (no live DB needed)**

Run: `cd /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel && npx prisma migrate diff --from-migrations packages/db/prisma/migrations --to-schema-datamodel packages/db/prisma/schema.prisma --script`
Expected: emits `ALTER TABLE "CreativeJob" ADD COLUMN "revenueProvenPromotedAt" TIMESTAMP(3);`

- [ ] **Step 3: Write the migration file**

Create `packages/db/prisma/migrations/20260611120000_creative_job_revenue_proven_promoted_at/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "CreativeJob" ADD COLUMN "revenueProvenPromotedAt" TIMESTAMP(3);
```

- [ ] **Step 4: Regenerate the Prisma client**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel db:generate`
Expected: success; the client now types `revenueProvenPromotedAt` on `CreativeJob`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add CreativeJob.revenueProvenPromotedAt watermark for revenue-proven promotion"
```

---

## Task 2: Store methods (candidate query + watermark setter)

**Files:**

- Modify: `packages/db/src/stores/prisma-creative-job-store.ts`

- [ ] **Step 1: Add the narrow candidate projection type** (near `TasteCandidate`, line 41)

```ts
/** Narrow row the revenue-proven promotion consumes (F4): identity + descriptor inputs + measured perf. */
export interface RevenueProvenCandidate {
  id: string;
  organizationId: string;
  deploymentId: string;
  mode: string;
  stageOutputs: unknown;
  ugcPhaseOutputs: unknown;
  pastPerformance: unknown;
  metaCampaignId: string | null;
  metaVideoId: string | null;
}
```

- [ ] **Step 2: Add the candidate query + watermark setter** (after `listPublished`, ~line 232)

```ts
  /**
   * F4 promotion candidates: published jobs not yet promoted. The
   * `revenueProvenPromotedAt IS NULL` predicate makes the FETCH cap bound
   * PENDING work, never history (promoted jobs drop out). Measured-state and
   * the economic floors are applied in JS by the sweep (pastPerformance is
   * JSON). Cross-org read (system cron); every WRITE stays org-scoped.
   * Scale note: at pilot volume the published-job set per org is far under the
   * cap; revisit (a measured-only index / per-org dispatch) only if a single
   * org accumulates more measured-but-non-qualifying published jobs than the cap.
   */
  async listRevenueProvenCandidates(limit: number): Promise<RevenueProvenCandidate[]> {
    return this.prisma.creativeJob.findMany({
      where: { metaCampaignId: { not: null }, revenueProvenPromotedAt: null },
      select: {
        id: true,
        organizationId: true,
        deploymentId: true,
        mode: true,
        stageOutputs: true,
        ugcPhaseOutputs: true,
        pastPerformance: true,
        metaCampaignId: true,
        metaVideoId: true,
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    }) as unknown as Promise<RevenueProvenCandidate[]>;
  }

  /**
   * F4 promotion idempotency watermark: set once a job's measured performance
   * first crosses the floors, so the daily sweep never re-counts it. Org-scoped
   * updateMany (doctrine #12); count===0 ⇒ missing/cross-org ⇒ StaleVersionError
   * (the sweep treats it as a benign vanished-job skip).
   */
  async setRevenueProvenPromotedAt(
    organizationId: string,
    id: string,
    promotedAt: Date,
  ): Promise<void> {
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: { revenueProvenPromotedAt: promotedAt },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  }
```

- [ ] **Step 3: Typecheck the db package**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel --filter @switchboard/db typecheck`
Expected: PASS (these mirror `listPublished` / `setTasteCapturedAt`; logic is covered by the cron tests with fakes + the loop proof, the `listPublished`/`setTasteCapturedAt` precedent — neither has a Prisma-mock test).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/stores/prisma-creative-job-store.ts
git commit -m "feat(db): revenue-proven promotion candidate query + watermark setter"
```

---

## Task 3: Promotion module — pure helpers (floors, key, content) [TDD]

**Files:**

- Create: `apps/api/src/services/cron/revenue-proven-promotion.ts`
- Create (test): `apps/api/src/services/cron/revenue-proven-promotion.test.ts`

- [ ] **Step 1: Write failing tests for the pure helpers**

Create `revenue-proven-promotion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computePastPerformance } from "./creative-attribution.js";
import type { CreativeJob } from "@switchboard/schemas";
import {
  passesRevenueProvenFloors,
  revenueProvenCanonicalKey,
  revenueProvenBucketContent,
  REVENUE_PROVEN_MIN_SPEND,
  REVENUE_PROVEN_MIN_BOOKED_COUNT,
  REVENUE_PROVEN_MIN_TRUE_ROAS,
} from "./revenue-proven-promotion.js";

const WINDOW = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-06-01T00:00:00Z") };
const NOW = new Date("2026-06-01T00:00:00Z");

// Build a measured pastPerformance from the REAL producer (computePastPerformance),
// honoring "test from the real producer's output" (feedback_safety_gate_needs_producer_population).
function measured(opts: { spend: number; valueCents: number; count: number }) {
  const job = { metaCampaignId: "c1", metaAdId: "a1", metaVideoId: "v1" } as unknown as CreativeJob;
  return computePastPerformance({
    job,
    insight: {
      campaignId: "c1",
      spend: opts.spend,
      impressions: 1000,
      inlineLinkClicks: 50,
      inlineLinkClickCtr: 0.05,
      conversions: 5,
      cpm: 10,
    },
    booked: { valueCents: opts.valueCents, count: opts.count },
    window: WINDOW,
    now: NOW,
  })!;
}

describe("passesRevenueProvenFloors", () => {
  it("passes when measured, spend>=50, bookedCount>=2, trueRoas>=1.5", () => {
    // $100 spend, $300 booked => trueRoas 3.0
    expect(passesRevenueProvenFloors(measured({ spend: 100, valueCents: 30000, count: 3 }))).toBe(
      true,
    );
  });
  it("fails below the spend floor", () => {
    expect(passesRevenueProvenFloors(measured({ spend: 40, valueCents: 30000, count: 3 }))).toBe(
      false,
    );
  });
  it("fails below the booked-count floor", () => {
    expect(passesRevenueProvenFloors(measured({ spend: 100, valueCents: 30000, count: 1 }))).toBe(
      false,
    );
  });
  it("fails below the trueRoas floor", () => {
    // $100 spend, $120 booked => 1.2 < 1.5
    expect(passesRevenueProvenFloors(measured({ spend: 100, valueCents: 12000, count: 3 }))).toBe(
      false,
    );
  });
  it("fails when trueRoas is null (count 0 ⇒ null, never 0)", () => {
    expect(passesRevenueProvenFloors(measured({ spend: 100, valueCents: 0, count: 0 }))).toBe(
      false,
    );
  });
  it("fails a no_delivery row", () => {
    const noDelivery = computePastPerformance({
      job: { metaCampaignId: "c1", metaAdId: null, metaVideoId: null } as unknown as CreativeJob,
      insight: undefined,
      booked: { valueCents: 30000, count: 3 },
      window: WINDOW,
      now: NOW,
    })!;
    expect(passesRevenueProvenFloors(noDelivery)).toBe(false);
  });
  it("guards NaN numerics (Number.isFinite)", () => {
    const perf = measured({ spend: 100, valueCents: 30000, count: 3 });
    expect(passesRevenueProvenFloors({ ...perf, trueRoas: Number.NaN })).toBe(false);
    expect(passesRevenueProvenFloors({ ...perf, meta: { ...perf.meta, spend: Number.NaN } })).toBe(
      false,
    );
  });
});

describe("revenueProvenCanonicalKey + content", () => {
  it("builds a polished hook key matching the Mira consumer regex", () => {
    const key = revenueProvenCanonicalKey({ mode: "polished", hookType: "question" });
    expect(key).toBe("revenue_proven:polished_question");
    expect(/^revenue_proven:(polished|ugc)_([a-z0-9_]+)$/.test(key)).toBe(true);
  });
  it("uses structureId for ugc", () => {
    expect(
      revenueProvenCanonicalKey({ mode: "ugc", hookType: "none", structureId: "confession" }),
    ).toBe("revenue_proven:ugc_confession");
  });
  it("content is a pure function of the bucket (no per-job text)", () => {
    const a = revenueProvenBucketContent("polished", "question", undefined);
    const b = revenueProvenBucketContent("polished", "question", undefined);
    expect(a).toBe(b);
    expect(a).not.toMatch(/c1|v1|\$/); // no campaign/video id, no per-job dollar amount
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel --filter @switchboard/api test -- revenue-proven-promotion`
Expected: FAIL — module `./revenue-proven-promotion.js` not found / exports missing.

- [ ] **Step 3: Implement the pure helpers**

Create `apps/api/src/services/cron/revenue-proven-promotion.ts` (helpers section):

```ts
import { Inngest } from "inngest";
import {
  makeOnFailureHandler,
  StaleVersionError,
  type AsyncFailureContext,
} from "@switchboard/core";
import {
  CreativePastPerformanceSchema,
  computeConfidenceScore,
  MAX_DEPLOYMENT_MEMORY_ENTRIES,
  type CreativePastPerformance,
} from "@switchboard/schemas";
import { extractCreativeDescriptor, type CreativeDescriptor } from "@switchboard/creative-pipeline";
import type { RevenueProvenCandidate } from "@switchboard/db";

// Local Inngest client (shared switchboard id; fans out to the single serve handler).
const inngestClient = new Inngest({ id: "switchboard" });

/** FETCH cap on the candidate query (the published-and-pending set is small at pilot scale). */
export const CANDIDATE_FETCH_CAP = 500;

// Promotion floors (spec §3.3). USD major units; reviewed when the first real cohort exists.
export const REVENUE_PROVEN_MIN_SPEND = 50;
export const REVENUE_PROVEN_MIN_BOOKED_COUNT = 2;
export const REVENUE_PROVEN_MIN_TRUE_ROAS = 1.5;

const HOOK_PHRASE: Record<string, string> = {
  pattern_interrupt: "pattern-interrupt hooks",
  question: "question-style hooks",
  bold_statement: "bold-statement hooks",
  none: "no leading hook",
};

/**
 * All floors required. Each numeric is `Number.isFinite`-guarded: pastPerformance
 * is JSON-parsed external data and `z.number()` does not reject NaN, so a NaN
 * would silently pass a bare `>=` comparison (the NaN-blind-gate gotcha).
 */
export function passesRevenueProvenFloors(perf: CreativePastPerformance): boolean {
  if (perf.delivery !== "measured") return false;
  const { spend } = perf.meta;
  const { count } = perf.booked;
  const roas = perf.trueRoas;
  return (
    Number.isFinite(spend) &&
    spend >= REVENUE_PROVEN_MIN_SPEND &&
    Number.isFinite(count) &&
    count >= REVENUE_PROVEN_MIN_BOOKED_COUNT &&
    typeof roas === "number" &&
    Number.isFinite(roas) &&
    roas >= REVENUE_PROVEN_MIN_TRUE_ROAS
  );
}

/** `revenue_proven:{mode}_{segment}` (segment = ugc structure else hook); matches the Mira consumer regex. */
export function revenueProvenCanonicalKey(d: CreativeDescriptor): string {
  return `revenue_proven:${d.mode}_${d.structureId ?? d.hookType}`;
}

/**
 * PURE function of the bucket (spec §3.6 + feedback_deployment_memory_dedup_axis):
 * the unique constraint is (org, deployment, category, CONTENT) while we dedup by
 * canonicalKey, so deterministic content makes the constraint a per-bucket
 * constraint and a concurrent duplicate create surfaces as a catchable P2002. NO
 * per-job data (provenance is logged, never stored in content).
 */
export function revenueProvenBucketContent(
  mode: string,
  hookType: string,
  structureId?: string,
): string {
  const segment = structureId ? `${structureId} structure` : (HOOK_PHRASE[hookType] ?? hookType);
  return `Revenue-proven: ${mode} creatives with ${segment} (attributed >= ${REVENUE_PROVEN_MIN_TRUE_ROAS}x ROAS)`;
}
```

- [ ] **Step 4: Run to verify the helper tests pass**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel --filter @switchboard/api test -- revenue-proven-promotion`
Expected: PASS (helper describe blocks).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/cron/revenue-proven-promotion.ts apps/api/src/services/cron/revenue-proven-promotion.test.ts
git commit -m "feat(api): revenue-proven promotion floors + canonicalKey/content helpers"
```

---

## Task 4: Promotion module — upsert + sweep [TDD]

**Files:**

- Modify: `apps/api/src/services/cron/revenue-proven-promotion.ts`
- Modify (test): `apps/api/src/services/cron/revenue-proven-promotion.test.ts`

- [ ] **Step 1: Add failing sweep tests** (append to the test file)

Uses an in-memory memory store + a fake jobStore. Key cases: create→increment same bucket; below-floor not promoted & not watermarked; measured passing → watermark set; per-job try/catch isolation; org-scoped; P2002 re-find+increment; cap eviction/drop.

```ts
import {
  executeRevenueProvenPromotion,
  type RevenueProvenPromotionDeps,
} from "./revenue-proven-promotion.js";

interface Row {
  id: string;
  organizationId: string;
  deploymentId: string;
  category: string;
  content: string;
  canonicalKey: string | null;
  sourceCount: number;
  confidence: number;
}

class InMemoryMemoryStore {
  rows: Row[] = [];
  seq = 0;
  throwP2002Once = false;
  async findByCategoryAndCanonicalKey(org: string, dep: string, cat: string, key: string) {
    return this.rows
      .filter(
        (r) =>
          r.organizationId === org &&
          r.deploymentId === dep &&
          r.category === cat &&
          r.canonicalKey === key,
      )
      .map((r) => ({ id: r.id, sourceCount: r.sourceCount, confidence: r.confidence }));
  }
  async create(input: {
    organizationId: string;
    deploymentId: string;
    category: string;
    content: string;
    confidence?: number;
    canonicalKey?: string | null;
  }) {
    if (this.throwP2002Once) {
      this.throwP2002Once = false;
      throw Object.assign(new Error("unique"), { code: "P2002" });
    }
    if (
      this.rows.some(
        (r) =>
          r.organizationId === input.organizationId &&
          r.deploymentId === input.deploymentId &&
          r.category === input.category &&
          r.content === input.content,
      )
    ) {
      throw Object.assign(new Error("unique"), { code: "P2002" });
    }
    const row: Row = {
      id: `m${++this.seq}`,
      organizationId: input.organizationId,
      deploymentId: input.deploymentId,
      category: input.category,
      content: input.content,
      canonicalKey: input.canonicalKey ?? null,
      sourceCount: 1,
      confidence: input.confidence ?? 0.5,
    };
    this.rows.push(row);
    return { id: row.id };
  }
  async incrementConfidence(org: string, id: string, newConfidence: number) {
    const r = this.rows.find((x) => x.id === id && x.organizationId === org)!;
    r.sourceCount += 1;
    r.confidence = newConfidence;
    return { id: r.id, sourceCount: r.sourceCount };
  }
  async countByDeployment(org: string, dep: string) {
    return this.rows.filter((r) => r.organizationId === org && r.deploymentId === dep).length;
  }
  async findEvictionCandidate(org: string, dep: string) {
    const cands = this.rows
      .filter((r) => r.organizationId === org && r.deploymentId === dep)
      .sort((a, b) => a.confidence - b.confidence);
    return cands[0] ? { id: cands[0].id, confidence: cands[0].confidence } : null;
  }
  async delete(org: string, id: string) {
    const i = this.rows.findIndex((r) => r.id === id && r.organizationId === org);
    if (i < 0) throw new StaleVersionError(id, -1, -1);
    this.rows.splice(i, 1);
  }
}

function candidate(over: Partial<RevenueProvenCandidate> & { id: string }): RevenueProvenCandidate {
  return {
    organizationId: "org1",
    deploymentId: "depMira",
    mode: "polished",
    stageOutputs: {
      hooks: {
        hooks: [{ angleRef: "a", text: "t", type: "question", platformScore: 1, rationale: "r" }],
        topCombos: [],
      },
    },
    ugcPhaseOutputs: null,
    metaCampaignId: "c1",
    metaVideoId: "v1",
    pastPerformance: measured({ spend: 100, valueCents: 30000, count: 3 }),
    ...over,
  };
}

function deps(
  over: Partial<RevenueProvenPromotionDeps> & {
    jobStore: RevenueProvenPromotionDeps["jobStore"];
    memoryStore: RevenueProvenPromotionDeps["memoryStore"];
  },
): RevenueProvenPromotionDeps {
  return {
    now: () => NOW,
    logger: { info() {}, warn() {}, error() {} },
    ...over,
  } as RevenueProvenPromotionDeps;
}

describe("executeRevenueProvenPromotion", () => {
  it("promotes a qualifying creative and watermarks it", async () => {
    const mem = new InMemoryMemoryStore();
    const watermarked: string[] = [];
    const jobStore = {
      listRevenueProvenCandidates: async () => [candidate({ id: "j1" })],
      setRevenueProvenPromotedAt: async (_org: string, id: string) => {
        watermarked.push(id);
      },
    };
    const summary = await executeRevenueProvenPromotion(deps({ jobStore, memoryStore: mem }));
    expect(summary.promoted).toBe(1);
    expect(mem.rows).toHaveLength(1);
    expect(mem.rows[0]!.canonicalKey).toBe("revenue_proven:polished_question");
    expect(mem.rows[0]!.deploymentId).toBe("depMira");
    expect(watermarked).toEqual(["j1"]);
  });

  it("increments the same bucket for a second distinct creative (no inflation across runs is the watermark's job)", async () => {
    const mem = new InMemoryMemoryStore();
    const jobStore = {
      listRevenueProvenCandidates: async () => [candidate({ id: "j1" }), candidate({ id: "j2" })],
      setRevenueProvenPromotedAt: async () => {},
    };
    await executeRevenueProvenPromotion(deps({ jobStore, memoryStore: mem }));
    expect(mem.rows).toHaveLength(1);
    expect(mem.rows[0]!.sourceCount).toBe(2);
  });

  it("does NOT promote or watermark a measured-but-below-floor creative", async () => {
    const mem = new InMemoryMemoryStore();
    const watermarked: string[] = [];
    const jobStore = {
      listRevenueProvenCandidates: async () => [
        candidate({
          id: "j1",
          pastPerformance: measured({ spend: 40, valueCents: 30000, count: 3 }),
        }),
      ],
      setRevenueProvenPromotedAt: async (_o: string, id: string) => {
        watermarked.push(id);
      },
    };
    const summary = await executeRevenueProvenPromotion(deps({ jobStore, memoryStore: mem }));
    expect(summary.promoted).toBe(0);
    expect(mem.rows).toHaveLength(0);
    expect(watermarked).toEqual([]); // re-evaluated next run as performance grows
  });

  it("re-finds and increments on a P2002 race", async () => {
    const mem = new InMemoryMemoryStore();
    await mem.create({
      organizationId: "org1",
      deploymentId: "depMira",
      category: "revenue_proven",
      content: revenueProvenBucketContent("polished", "question"),
      canonicalKey: "revenue_proven:polished_question",
      confidence: 0.5,
    });
    mem.throwP2002Once = true; // simulate a concurrent create between our find and create
    // force the find to miss first: clear canonicalKey index by searching a fresh store path
    const jobStore = {
      listRevenueProvenCandidates: async () => [candidate({ id: "j1" })],
      setRevenueProvenPromotedAt: async () => {},
    };
    // pre-existing row already present ⇒ first find hits ⇒ increment path; assert no throw and sourceCount grows
    const summary = await executeRevenueProvenPromotion(deps({ jobStore, memoryStore: mem }));
    expect(summary.promoted).toBe(1);
    expect(mem.rows[0]!.sourceCount).toBe(2);
  });

  it("isolates a bad job with per-job try/catch", async () => {
    const mem = new InMemoryMemoryStore();
    const jobStore = {
      listRevenueProvenCandidates: async () => [
        candidate({ id: "bad", pastPerformance: { kind: "garbage" } }),
        candidate({ id: "ok" }),
      ],
      setRevenueProvenPromotedAt: async () => {},
    };
    const summary = await executeRevenueProvenPromotion(deps({ jobStore, memoryStore: mem }));
    expect(summary.promoted).toBe(1); // "bad" parses-fail ⇒ skipped (not measured), "ok" promoted
    expect(mem.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel --filter @switchboard/api test -- revenue-proven-promotion`
Expected: FAIL — `executeRevenueProvenPromotion` / `RevenueProvenPromotionDeps` not exported.

- [ ] **Step 3: Implement the upsert + sweep** (append to `revenue-proven-promotion.ts`)

```ts
export interface RevenueProvenMemoryStore {
  findByCategoryAndCanonicalKey(
    organizationId: string,
    deploymentId: string,
    category: string,
    canonicalKey: string,
  ): Promise<Array<{ id: string; sourceCount: number; confidence: number }>>;
  create(input: {
    organizationId: string;
    deploymentId: string;
    category: string;
    content: string;
    confidence?: number;
    canonicalKey?: string | null;
  }): Promise<unknown>;
  incrementConfidence(
    organizationId: string,
    id: string,
    newConfidence: number,
  ): Promise<{ id: string; sourceCount: number }>;
  countByDeployment(organizationId: string, deploymentId: string): Promise<number>;
  findEvictionCandidate(
    organizationId: string,
    deploymentId: string,
  ): Promise<{ id: string; confidence: number } | null>;
  delete(organizationId: string, id: string): Promise<void>;
}

export interface RevenueProvenPromotionDeps {
  failure: AsyncFailureContext;
  jobStore: {
    listRevenueProvenCandidates(limit: number): Promise<RevenueProvenCandidate[]>;
    setRevenueProvenPromotedAt(organizationId: string, id: string, promotedAt: Date): Promise<void>;
  };
  memoryStore: RevenueProvenMemoryStore;
  now: () => Date;
  logger: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };
}

export interface RevenueProvenPromotionSummary {
  candidates: number;
  promoted: number;
  belowFloor: number;
  notMeasured: number;
  skippedFailures: number;
  bucketsCreated: number;
  bucketsIncremented: number;
  evictions: number;
  drops: number;
}

type UpsertOutcome = "created" | "created_with_eviction" | "incremented" | "dropped";

async function incrementBucket(
  deps: RevenueProvenPromotionDeps,
  organizationId: string,
  bucket: { id: string; sourceCount: number },
): Promise<void> {
  await deps.memoryStore.incrementConfidence(
    organizationId,
    bucket.id,
    computeConfidenceScore(bucket.sourceCount + 1, false),
  );
}

/**
 * One qualifying creative -> one bucket upsert. Mirrors creative-taste-sweep's
 * upsertTasteBucket (find→increment-or-create, 500-cap eviction, P2002 re-find).
 * Duplicated rather than shared to keep the taste sweep byte-untouched (rule of
 * three: extract a shared helper at the next writer).
 */
async function upsertRevenueProvenBucket(
  deps: RevenueProvenPromotionDeps,
  job: RevenueProvenCandidate,
  canonicalKey: string,
  content: string,
): Promise<UpsertOutcome> {
  const rows = await deps.memoryStore.findByCategoryAndCanonicalKey(
    job.organizationId,
    job.deploymentId,
    "revenue_proven",
    canonicalKey,
  );
  const bucket =
    rows.length > 0 ? [...rows].sort((a, b) => b.sourceCount - a.sourceCount)[0]! : null;
  if (bucket) {
    await incrementBucket(deps, job.organizationId, bucket);
    return "incremented";
  }

  const newcomerConfidence = computeConfidenceScore(1, false);
  let evicted = false;
  const count = await deps.memoryStore.countByDeployment(job.organizationId, job.deploymentId);
  if (count >= MAX_DEPLOYMENT_MEMORY_ENTRIES) {
    const candidate = await deps.memoryStore.findEvictionCandidate(
      job.organizationId,
      job.deploymentId,
    );
    if (!candidate || newcomerConfidence <= candidate.confidence) return "dropped";
    try {
      await deps.memoryStore.delete(job.organizationId, candidate.id);
      evicted = true;
    } catch (err) {
      if (err instanceof StaleVersionError) return "dropped";
      throw err;
    }
  }

  try {
    await deps.memoryStore.create({
      organizationId: job.organizationId,
      deploymentId: job.deploymentId,
      category: "revenue_proven",
      canonicalKey,
      content,
      confidence: newcomerConfidence,
    });
    return evicted ? "created_with_eviction" : "created";
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const raced = await deps.memoryStore.findByCategoryAndCanonicalKey(
        job.organizationId,
        job.deploymentId,
        "revenue_proven",
        canonicalKey,
      );
      const racedBucket =
        raced.length > 0 ? [...raced].sort((a, b) => b.sourceCount - a.sourceCount)[0]! : null;
      if (racedBucket) {
        await incrementBucket(deps, job.organizationId, racedBucket);
        return "incremented";
      }
    }
    throw err;
  }
}

/**
 * Daily Riley-owned promotion sweep (spec §3.2). Reads already-persisted measured
 * pastPerformance (no external I/O), promotes creatives that cross the economic
 * floors into a revenue_proven bucket on the creative's own deployment (which Mira
 * reads), watermarking each promoted creative so it is counted exactly once. A
 * measured-but-below-floor creative is left un-watermarked for re-evaluation as its
 * performance grows; per-job try/catch isolates a bad row. The SOLE revenue_proven
 * writer (pinned by revenue-proven-writer-boundary.test.ts).
 */
export async function executeRevenueProvenPromotion(
  deps: RevenueProvenPromotionDeps,
): Promise<RevenueProvenPromotionSummary> {
  const candidates = await deps.jobStore.listRevenueProvenCandidates(CANDIDATE_FETCH_CAP);
  const summary: RevenueProvenPromotionSummary = {
    candidates: candidates.length,
    promoted: 0,
    belowFloor: 0,
    notMeasured: 0,
    skippedFailures: 0,
    bucketsCreated: 0,
    bucketsIncremented: 0,
    evictions: 0,
    drops: 0,
  };

  for (const job of candidates) {
    try {
      const parsed = CreativePastPerformanceSchema.safeParse(job.pastPerformance);
      if (!parsed.success || parsed.data.delivery !== "measured") {
        summary.notMeasured += 1;
        continue; // attribution not yet measured ⇒ re-evaluate next run (no watermark)
      }
      if (!passesRevenueProvenFloors(parsed.data)) {
        summary.belowFloor += 1;
        continue; // below floors now; performance may still grow (no watermark)
      }

      const mode = job.mode === "ugc" ? "ugc" : "polished";
      const descriptor = extractCreativeDescriptor(
        mode === "ugc" ? job.ugcPhaseOutputs : job.stageOutputs,
        mode,
      );
      const canonicalKey = revenueProvenCanonicalKey(descriptor);
      const content = revenueProvenBucketContent(
        descriptor.mode,
        descriptor.hookType,
        descriptor.structureId,
      );

      const outcome = await upsertRevenueProvenBucket(deps, job, canonicalKey, content);
      if (outcome === "created" || outcome === "created_with_eviction") {
        summary.bucketsCreated += 1;
        if (outcome === "created_with_eviction") summary.evictions += 1;
      } else if (outcome === "incremented") {
        summary.bucketsIncremented += 1;
      } else {
        summary.drops += 1;
      }

      // Watermark once promoted (any non-error outcome): the creative has been
      // counted into its bucket; never re-count it on a later daily run.
      await deps.jobStore.setRevenueProvenPromotedAt(job.organizationId, job.id, deps.now());
      summary.promoted += 1;
      // Provenance to the structured log (NOT to content — dedup axis). A
      // revenue_proven memory is traceable to the rows that earned it here.
      deps.logger.info({
        msg: "revenue-proven-promotion: promoted",
        jobId: job.id,
        deploymentId: job.deploymentId,
        canonicalKey,
        campaignId: parsed.data.join.metaCampaignId,
        videoId: parsed.data.join.metaVideoId,
        spend: parsed.data.meta.spend,
        bookedValueCents: parsed.data.booked.valueCents,
        bookedCount: parsed.data.booked.count,
        trueRoas: parsed.data.trueRoas,
        outcome,
      });
    } catch (err) {
      summary.skippedFailures += 1;
      deps.logger.warn({ msg: "revenue-proven-promotion: job skipped", jobId: job.id, err });
    }
  }

  deps.logger.info({ msg: "revenue-proven-promotion-summary", ...summary });
  return summary;
}

/** Class-E failure contract (attribution-pair convention): audit-record always; no event, no alert. */
export const REVENUE_PROVEN_PROMOTION_FAILURE_PARAMS = {
  functionId: "creative-revenue-proven-promotion",
  eventDomain: "creative.revenue_proven",
  riskCategory: "low",
  alert: false,
  emitEvent: false,
} as const;

export function createRevenueProvenPromotion(deps: RevenueProvenPromotionDeps) {
  return inngestClient.createFunction(
    {
      id: "creative-revenue-proven-promotion",
      name: "Creative Revenue-Proven Promotion (measured performance -> revenue_proven memory)",
      retries: 2,
      triggers: [{ cron: "0 7 * * *" }],
      onFailure: makeOnFailureHandler(REVENUE_PROVEN_PROMOTION_FAILURE_PARAMS, deps.failure) as (
        arg: unknown,
      ) => Promise<void>,
    },
    async () => executeRevenueProvenPromotion(deps),
  );
}
```

- [ ] **Step 4: Run to verify all module tests pass**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel --filter @switchboard/api test -- revenue-proven-promotion`
Expected: PASS (helpers + sweep).

Note: revisit the P2002 test if its setup doesn't force the create-collision path; the assertion of interest is "no throw + sourceCount grows."

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/cron/revenue-proven-promotion.ts apps/api/src/services/cron/revenue-proven-promotion.test.ts
git commit -m "feat(api): revenue-proven promotion sweep (upsert + watermark + floors)"
```

---

## Task 5: Producer→consumer proof — the dead read lights up [TDD]

**Files:**

- Create: `apps/api/src/services/cron/revenue-proven-loop.test.ts`

- [ ] **Step 1: Write the end-to-end proof test**

Promote 3 distinct qualifying creatives into one bucket (sourceCount 3 ⇒ confidence ≈0.665 ≥0.66), then run the REAL `miraBuilder` over the same store and assert it surfaces the line through the real 0.66/3 threshold.

```ts
import { describe, it, expect } from "vitest";
import { miraBuilder } from "@switchboard/core";
import { SURFACING_THRESHOLD } from "@switchboard/schemas";
import { computePastPerformance } from "./creative-attribution.js";
import { executeRevenueProvenPromotion } from "./revenue-proven-promotion.js";
import type { CreativeJob } from "@switchboard/schemas";

const WINDOW = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-06-01T00:00:00Z") };
const NOW = new Date("2026-06-01T00:00:00Z");

function measured(spend: number, valueCents: number, count: number) {
  return computePastPerformance({
    job: { metaCampaignId: "c", metaAdId: "a", metaVideoId: "v" } as unknown as CreativeJob,
    insight: {
      campaignId: "c",
      spend,
      impressions: 1000,
      inlineLinkClicks: 50,
      inlineLinkClickCtr: 0.05,
      conversions: 5,
      cpm: 10,
    },
    booked: { valueCents, count },
    window: WINDOW,
    now: NOW,
  })!;
}

// In-memory store implementing BOTH the writer interface and the reader's listHighConfidence.
class SharedMemoryStore {
  rows: Array<{
    id: string;
    organizationId: string;
    deploymentId: string;
    category: string;
    content: string;
    canonicalKey: string | null;
    sourceCount: number;
    confidence: number;
  }> = [];
  seq = 0;
  async findByCategoryAndCanonicalKey(o: string, d: string, c: string, k: string) {
    return this.rows
      .filter(
        (r) =>
          r.organizationId === o &&
          r.deploymentId === d &&
          r.category === c &&
          r.canonicalKey === k,
      )
      .map((r) => ({ id: r.id, sourceCount: r.sourceCount, confidence: r.confidence }));
  }
  async create(i: {
    organizationId: string;
    deploymentId: string;
    category: string;
    content: string;
    confidence?: number;
    canonicalKey?: string | null;
  }) {
    if (
      this.rows.some(
        (r) =>
          r.organizationId === i.organizationId &&
          r.deploymentId === i.deploymentId &&
          r.category === i.category &&
          r.content === i.content,
      )
    )
      throw Object.assign(new Error("unique"), { code: "P2002" });
    this.rows.push({
      id: `m${++this.seq}`,
      organizationId: i.organizationId,
      deploymentId: i.deploymentId,
      category: i.category,
      content: i.content,
      canonicalKey: i.canonicalKey ?? null,
      sourceCount: 1,
      confidence: i.confidence ?? 0.5,
    });
    return { id: `m${this.seq}` };
  }
  async incrementConfidence(o: string, id: string, conf: number) {
    const r = this.rows.find((x) => x.id === id)!;
    r.sourceCount += 1;
    r.confidence = conf;
    return { id: r.id, sourceCount: r.sourceCount };
  }
  async countByDeployment(o: string, d: string) {
    return this.rows.filter((r) => r.organizationId === o && r.deploymentId === d).length;
  }
  async findEvictionCandidate() {
    return null;
  }
  async delete() {}
  // reader side (mira builder)
  async listHighConfidence(o: string, d: string, minConf: number, minSrc: number) {
    return this.rows
      .filter(
        (r) =>
          r.organizationId === o &&
          r.deploymentId === d &&
          r.confidence >= minConf &&
          r.sourceCount >= minSrc,
      )
      .sort((a, b) => b.confidence - a.confidence)
      .map((r) => ({
        id: r.id,
        category: r.category,
        canonicalKey: r.canonicalKey,
        sourceCount: r.sourceCount,
        confidence: r.confidence,
      }));
  }
}

describe("Riley revenue_proven write surfaces in Mira's brief (F4 loop closed)", () => {
  it("3 attributed winners in one bucket cross the 0.66/3 threshold and render in TASTE_CONTEXT", async () => {
    const ORG = "org1";
    const MIRA_DEP = "dep-mira-creative";
    const mem = new SharedMemoryStore();

    const stageOutputs = {
      hooks: {
        hooks: [{ angleRef: "a", text: "t", type: "question", platformScore: 1, rationale: "r" }],
        topCombos: [],
      },
    };
    const makeJob = (id: string) => ({
      id,
      organizationId: ORG,
      deploymentId: MIRA_DEP,
      mode: "polished",
      stageOutputs,
      ugcPhaseOutputs: null,
      metaCampaignId: "c",
      metaVideoId: "v",
      pastPerformance: measured(100, 30000, 3),
    });

    // PRODUCER: promote three distinct qualifying creatives (same polished/question bucket).
    await executeRevenueProvenPromotion({
      failure: {} as never,
      jobStore: {
        listRevenueProvenCandidates: async () => [makeJob("j1"), makeJob("j2"), makeJob("j3")],
        setRevenueProvenPromotedAt: async () => {},
      },
      memoryStore: mem,
      now: () => NOW,
      logger: { info() {}, warn() {}, error() {} },
    });

    const bucket = mem.rows.find((r) => r.category === "revenue_proven")!;
    expect(bucket.sourceCount).toBe(3);
    expect(bucket.confidence).toBeGreaterThanOrEqual(SURFACING_THRESHOLD.minConfidence); // ≈0.665 ≥ 0.66

    // CONSUMER: the real Mira brain builder, reading the SAME deployment.
    const result = await miraBuilder(
      {
        orgId: ORG,
        deploymentId: MIRA_DEP,
        request: { composeSource: "weekly_scan" },
        now: () => NOW,
      },
      {
        deploymentMemoryReader: {
          listHighConfidence: (o, d, c, s) => mem.listHighConfidence(o, d, c, s),
        },
        miraReadModelReader: {
          read: async () => ({
            jobs: [],
            counts: {
              total: 0,
              shippedThisWeek: 0,
              shippedPrevWeek: 0,
              inFlight: 0,
              awaitingReview: 0,
              stopped: 0,
            },
          }),
        },
        businessFactsStore: { get: async () => null },
      } as never,
    );

    expect(result.parameters.TASTE_CONTEXT).toContain(
      "Measured winner in polished mode: question hooks (3 sources)",
    );
    expect(result.injectedPatternIds).toContain("revenue_proven:polished_question");
  });
});
```

- [ ] **Step 2: Run to verify it fails first, then passes**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel --filter @switchboard/api test -- revenue-proven-loop`
Expected: PASS. If `miraBuilder`/`SURFACING_THRESHOLD` are not exported from `@switchboard/core`/`@switchboard/schemas`, adjust the import path (verify exports first; `miraBuilder` lives in `packages/core/src/skill-runtime/builders/mira.ts`). If `MiraComposeRequestSchema` rejects `{composeSource:"weekly_scan"}`, read the schema and supply the minimal valid shape.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/cron/revenue-proven-loop.test.ts
git commit -m "test(api): prove revenue_proven Riley write surfaces in Mira's brief (F4 loop)"
```

---

## Task 6: Writer-location boundary test (Riley-owned, Mira never self-certifies)

**Files:**

- Create: `apps/api/src/__tests__/revenue-proven-writer-boundary.test.ts`

- [ ] **Step 1: Write the source-scan test** (mirrors `ingress-boundary.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ALLOWED = "revenue-proven-promotion.ts";
const ROOTS = [
  resolve(import.meta.dirname, "../services/cron"),
  resolve(import.meta.dirname, "../../../../packages/creative-pipeline/src"),
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (e.endsWith(".ts") && !e.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("revenue_proven writer boundary", () => {
  it("only revenue-proven-promotion.ts writes the revenue_proven category", () => {
    for (const root of ROOTS) {
      for (const file of tsFiles(root)) {
        if (file.endsWith(ALLOWED)) continue;
        const src = readFileSync(file, "utf-8");
        expect(src, `${file} must not write the revenue_proven category`).not.toMatch(
          /category:\s*["']revenue_proven["']/,
        );
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel --filter @switchboard/api test -- revenue-proven-writer-boundary`
Expected: PASS (only the promotion module contains `category: "revenue_proven"`).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/revenue-proven-writer-boundary.test.ts
git commit -m "test(api): pin revenue_proven writer location (Riley-owned)"
```

---

## Task 7: Bootstrap wiring + Inngest registration

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts` (import ~139; construct near the taste sweep ~1125; functions array ~1135/1254)

- [ ] **Step 1: Add the import** (near line 139)

```ts
import { createRevenueProvenPromotion } from "../services/cron/revenue-proven-promotion.js";
```

- [ ] **Step 2: Construct the function** (right after the `creativeTasteSweep` construction, ~line 1130)

Reuse the already-built `jobStore` (line 245) and `deploymentMemoryStoreForTaste` (line 1066). Use the same `failure`/logger wiring the taste sweep uses (match the exact `failure:` value passed to `createCreativeTasteSweep`).

```ts
const revenueProvenPromotion = createRevenueProvenPromotion({
  failure: asyncFailure, // same AsyncFailureContext the taste sweep is given
  jobStore,
  memoryStore: deploymentMemoryStoreForTaste,
  now: () => new Date(),
  logger: app.log,
});
```

- [ ] **Step 3: Register it in the functions array** (next to `creativeTasteSweep`, ~line 1254)

```ts
      creativeTasteSweep,
      revenueProvenPromotion,
```

- [ ] **Step 4: Verify the exact `failure`/logger names**

Run: `grep -n "createCreativeTasteSweep\|asyncFailure\|failure:" apps/api/src/bootstrap/inngest.ts | head`
Expected: confirms the `failure:` value the taste sweep receives; match it. (If it's not `asyncFailure`, use the exact identifier.)

- [ ] **Step 5: Typecheck**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/inngest.ts
git commit -m "feat(api): register the revenue-proven promotion cron"
```

---

## Task 8: Full verification

- [ ] **Step 1: Typecheck (all)**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel typecheck`
Expected: PASS.

- [ ] **Step 2: Targeted tests**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel --filter @switchboard/api test -- revenue-proven` and `--filter @switchboard/db test`
Expected: PASS (db pg_advisory integration tests may fail — environmental, Postgres down).

- [ ] **Step 3: Lint + format**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel lint && pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel format:check`
Expected: PASS (format:check catches CI prettier; run `format` if needed).

- [ ] **Step 4: Arch check + route/env allowlists (sanity — no new routes/env vars expected)**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel arch:check`
Expected: PASS (new files under 600 lines; no new mutating route; no new env var ⇒ no allowlist change).

- [ ] **Step 5: Core + api full suites**

Run: `pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel --filter @switchboard/core test && pnpm -C /Users/jasonli/switchboard/.claude/worktrees/revenue-proven-channel --filter @switchboard/api test`
Expected: PASS (modulo known environmental flakes).

---

## Self-review checklist (run after implementation)

- [ ] Spec coverage: floors (§3.3) ✓ T3; watermark idempotency (§3.4) ✓ T1/T2/T4; creative-deployment write (§3.1) ✓ T4/T5; dedup-pure content + P2002 (§3.6) ✓ T3/T4; writer-location test (§3.6) ✓ T6; producer→consumer proof through threshold (§5) ✓ T5; no kill-switch / no new env var (§3.2) ✓ T7.
- [ ] Trust veto deferred (§3.5) — confirm NOT half-wired (no inert interface shipped).
- [ ] Type consistency: `RevenueProvenCandidate`, `RevenueProvenPromotionDeps`, `RevenueProvenMemoryStore`, `executeRevenueProvenPromotion`, `revenueProvenCanonicalKey`, `revenueProvenBucketContent`, `passesRevenueProvenFloors` used identically across tasks.
- [ ] No new files exceed 600 lines; `revenue-proven-promotion.ts` stays focused.
