// ---------------------------------------------------------------------------
// PrismaCreativeJobStore.listTasteCandidates — Leg-2 starvation guard
// (EV-17 / SPINE-8 / BUG-7)
//
// Real-Postgres integration suite. Requires DATABASE_URL (CI: the "Integration —
// Real Postgres" job). Skips when unset, so it no-ops in every Postgres-free lane.
//
// The mocked unit suite (prisma-creative-job-store-slice2.test.ts) stubs findMany
// and $queryRaw, so it cannot prove ORDER BY + LIMIT semantics. Only a real
// Postgres read shows that an OLD re-decided row still surfaces under a full
// newest-N page of non-re-decided captured rows. Before the fix, Leg-2 did
// `take: limit` (newest first) THEN JS-filtered to re-decided rows, so an old
// re-decision starved behind the page; the fix pushes the watermark predicate
// (reviewDecidedAt > tasteCapturedAt) into SQL so LIMIT applies AFTER the filter.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaCreativeJobStore } from "../prisma-creative-job-store.js";

const ORG_ID = "test-org:ev17-taste-starvation";
const LISTING_ID = "ev17-taste-listing";
const DEPLOYMENT_ID = "ev17-taste-deployment";

describe.skipIf(!process.env["DATABASE_URL"])(
  "PrismaCreativeJobStore.listTasteCandidates — Leg-2 starvation (real PG, SPINE-8 / BUG-7)",
  () => {
    const prisma = new PrismaClient();
    const store = new PrismaCreativeJobStore(prisma);

    // Each CreativeJob requires a unique AgentTask (FK), which requires an
    // AgentDeployment + AgentListing. Listing + deployment are seeded once; one
    // task per job is created alongside the job.
    async function seedJob(input: {
      id: string;
      reviewDecidedAt: Date;
      tasteCapturedAt: Date | null;
    }): Promise<void> {
      await prisma.agentTask.create({
        data: {
          id: `task-${input.id}`,
          deploymentId: DEPLOYMENT_ID,
          organizationId: ORG_ID,
          listingId: LISTING_ID,
          category: "creative",
        },
      });
      await prisma.creativeJob.create({
        data: {
          id: input.id,
          taskId: `task-${input.id}`,
          organizationId: ORG_ID,
          deploymentId: DEPLOYMENT_ID,
          productDescription: "x",
          targetAudience: "y",
          platforms: ["meta"],
          reviewDecision: "kept",
          reviewDecidedAt: input.reviewDecidedAt,
          tasteCapturedAt: input.tasteCapturedAt,
        },
      });
    }

    async function clearJobs(): Promise<void> {
      await prisma.creativeJob.deleteMany({ where: { organizationId: ORG_ID } });
      await prisma.agentTask.deleteMany({ where: { organizationId: ORG_ID } });
    }

    beforeAll(async () => {
      await prisma.$connect();
      await clearJobs();
      await prisma.agentDeployment.deleteMany({ where: { id: DEPLOYMENT_ID } });
      await prisma.agentListing.deleteMany({ where: { id: LISTING_ID } });
      await prisma.agentListing.create({
        data: {
          id: LISTING_ID,
          name: "EV17 Taste Listing",
          slug: "ev17-taste-listing",
          description: "fixture",
        },
      });
      await prisma.agentDeployment.create({
        data: { id: DEPLOYMENT_ID, organizationId: ORG_ID, listingId: LISTING_ID },
      });
    });

    beforeEach(async () => {
      await clearJobs();
    });

    afterAll(async () => {
      await clearJobs();
      await prisma.agentDeployment.deleteMany({ where: { id: DEPLOYMENT_ID } });
      await prisma.agentListing.deleteMany({ where: { id: LISTING_ID } });
      await prisma.$disconnect();
    });

    it("an OLD re-decided row still surfaces under a full newest-N page of non-re-decided captured rows", async () => {
      const LIMIT = 3;
      // OLD re-decided row: its (re)decision is strictly newer than its last
      // capture (so it IS a pending gesture), but its decision is extreme-old so
      // it always sorts within leg-2's oldest-first LIMIT even on a shared DB
      // carrying other re-decided rows. It is far older than the fresh page below.
      await seedJob({
        id: "old-redecided",
        reviewDecidedAt: new Date("2020-01-02T00:00:00Z"),
        tasteCapturedAt: new Date("2020-01-01T00:00:00Z"),
      });
      // LIMIT newer captured rows that are NOT re-decided (captured AFTER decision),
      // so they fill the newest-N page but carry no pending gesture.
      for (let i = 0; i < LIMIT; i++) {
        const decided = new Date(Date.UTC(2026, 5, 10 + i, 0, 0, 0));
        await seedJob({
          id: `fresh-${i}`,
          reviewDecidedAt: decided,
          tasteCapturedAt: new Date(decided.getTime() + 60_000),
        });
      }

      const ids = (await store.listTasteCandidates(LIMIT)).map((r) => r.id);

      // The fix surfaces the starved old re-decision. The pre-fix take-before-filter
      // returns only the fresh non-re-decided page (filtered to empty), omitting it.
      expect(ids).toContain("old-redecided");
    });
  },
);
