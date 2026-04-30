import { describe, it, expect } from "vitest";
import {
  PrismaClient,
  PrismaDeploymentLifecycleStore,
  PrismaWorkTraceStore,
} from "@switchboard/db";

// Integration coverage for the DeploymentLifecycleStore persistence boundary.
// Asserts that haltAll writes both the agentDeployment status mutation and the
// operator-mutation WorkTrace row, that the post-tx finalize transitions the
// trace to outcome="completed" with lockedAt stamped, and that the integrity
// metadata (ingressPath, hashInputVersion, mode, intent, contentHash) matches
// what the route layer relies on.
describe.skipIf(!process.env["DATABASE_URL"])(
  "PrismaDeploymentLifecycleStore (integration)",
  () => {
    it("haltAll flips active deployments and writes a finalized WorkTrace row", async () => {
      const prisma = new PrismaClient();
      const orgId = `org_dls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let workTraceId: string | undefined;
      let listingId: string | undefined;
      const deploymentIds: string[] = [];

      try {
        const listing = await prisma.agentListing.create({
          data: { slug: `dls-it-${Date.now()}`, title: "DLS IT", trustScore: 75, status: "active" },
        });
        listingId = listing.id;

        const d1 = await prisma.agentDeployment.create({
          data: {
            organizationId: orgId,
            listingId: listing.id,
            status: "active",
            skillSlug: "alex",
          },
        });
        const d2 = await prisma.agentDeployment.create({
          data: {
            organizationId: orgId,
            listingId: listing.id,
            status: "active",
            skillSlug: "ops",
          },
        });
        deploymentIds.push(d1.id, d2.id);

        const workTraceStore = new PrismaWorkTraceStore(prisma, {
          auditLedger: { record: async () => undefined } as never,
          operatorAlerter: { alert: async () => undefined } as never,
        });
        const store = new PrismaDeploymentLifecycleStore(prisma, workTraceStore);

        const result = await store.haltAll({
          organizationId: orgId,
          operator: { type: "user", id: "user_op_int" },
          reason: "integration test",
        });
        workTraceId = result.workTraceId;

        expect(result.count).toBe(2);
        expect(result.affectedDeploymentIds.sort()).toEqual([d1.id, d2.id].sort());

        const traceRow = await prisma.workTrace.findUnique({
          where: { workUnitId: result.workTraceId },
        });
        expect(traceRow).not.toBeNull();
        expect(traceRow?.intent).toBe("agent_deployment.halt");
        expect(traceRow?.mode).toBe("operator_mutation");
        expect(traceRow?.ingressPath).toBe("store_recorded_operator_mutation");
        expect(traceRow?.hashInputVersion).toBe(2);
        expect(traceRow?.contentHash).toBeTruthy();
        expect(traceRow?.outcome).toBe("completed");
        expect(traceRow?.lockedAt).not.toBeNull();
        expect(traceRow?.executionStartedAt).not.toBeNull();
        expect(traceRow?.completedAt).not.toBeNull();
        expect(traceRow?.actorType).toBe("user");
        expect(traceRow?.actorId).toBe("user_op_int");
        expect(traceRow?.trigger).toBe("api");
        expect(traceRow?.organizationId).toBe(orgId);

        const after1 = await prisma.agentDeployment.findUnique({ where: { id: d1.id } });
        const after2 = await prisma.agentDeployment.findUnique({ where: { id: d2.id } });
        expect(after1?.status).toBe("paused");
        expect(after2?.status).toBe("paused");
      } finally {
        if (workTraceId) {
          await prisma.workTrace.delete({ where: { workUnitId: workTraceId } }).catch(() => {});
        }
        for (const id of deploymentIds) {
          await prisma.agentDeployment.delete({ where: { id } }).catch(() => {});
        }
        if (listingId) {
          await prisma.agentListing.delete({ where: { id: listingId } }).catch(() => {});
        }
        await prisma.$disconnect();
      }
    });
  },
);
