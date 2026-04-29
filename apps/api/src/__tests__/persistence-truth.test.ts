import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("Persistence truth invariants", () => {
  let app: FastifyInstance;
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  describe("single-persistence-spine", () => {
    it("propose route does not create synthetic envelopes (envelope-bridge removed)", async () => {
      const envelopesBefore = await app.storageContext.envelopes.list({ limit: 100 });
      const countBefore = envelopesBefore.length;

      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: { "Idempotency-Key": `truth-1-${Date.now()}` },
        payload: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_truth" },
          principalId: "default",
          organizationId: "org_test",
          cartridgeId: "digital-ads",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.workUnitId).toBeDefined();

      // Phase 4: CartridgeMode executes directly without envelope creation.
      // Zero envelopes should be created on any new flow.
      const envelopesAfter = await app.storageContext.envelopes.list({ limit: 100 });
      const newEnvelopes = envelopesAfter.length - countBefore;
      expect(newEnvelopes).toBe(0);
    });

    it("WorkTrace carries parameters and governance constraints from submit", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: { "Idempotency-Key": `truth-2-${Date.now()}` },
        payload: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_params" },
          principalId: "default",
          organizationId: "org_test",
          cartridgeId: "digital-ads",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.outcome).toBe("EXECUTED");

      const traceStore = (
        app.platformIngress as unknown as {
          config: {
            traceStore: {
              getByWorkUnitId: (id: string) => Promise<{ trace: Record<string, unknown> } | null>;
            };
          };
        }
      ).config.traceStore;
      const traceResult = await traceStore.getByWorkUnitId(body.workUnitId);
      const trace = traceResult?.trace ?? null;
      expect(trace).not.toBeNull();
      expect(trace!.parameters).toBeDefined();
      expect((trace!.parameters as Record<string, unknown>).campaignId).toBe("camp_params");
      expect(trace!.governanceConstraints).toBeDefined();
    });

    it("approval continuation updates the same WorkTrace", async () => {
      const spec = await app.storageContext.identity.getSpecByPrincipalId("default");
      if (spec) {
        spec.riskTolerance = {
          ...spec.riskTolerance,
          medium: "standard" as const,
          high: "elevated" as const,
        };
        await app.storageContext.identity.saveSpec(spec);
      }

      const proposeRes = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: { "Idempotency-Key": `truth-3-${Date.now()}` },
        payload: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_approval" },
          principalId: "default",
          organizationId: "org_test",
          cartridgeId: "digital-ads",
        },
      });

      const proposeBody = proposeRes.json();
      expect(proposeBody.outcome).toBe("PENDING_APPROVAL");
      const workUnitId = proposeBody.workUnitId;

      const traceStore = (
        app.platformIngress as unknown as {
          config: {
            traceStore: {
              getByWorkUnitId: (id: string) => Promise<{ trace: Record<string, unknown> } | null>;
            };
          };
        }
      ).config.traceStore;
      const traceBeforeResult = await traceStore.getByWorkUnitId(workUnitId);
      const traceBefore = traceBeforeResult?.trace ?? null;
      expect(traceBefore).not.toBeNull();
      expect(traceBefore!.outcome).toBe("pending_approval");

      const approveRes = await app.inject({
        method: "POST",
        url: `/api/approvals/${proposeBody.approvalRequest.id}/respond`,
        payload: {
          action: "approve",
          respondedBy: "reviewer_1",
          bindingHash: proposeBody.approvalRequest.bindingHash,
        },
      });

      expect(approveRes.statusCode).toBe(200);

      const traceAfterResult = await traceStore.getByWorkUnitId(workUnitId);
      const traceAfter = traceAfterResult?.trace ?? null;
      expect(traceAfter).not.toBeNull();
      expect(traceAfter!.approvalOutcome).toBe("approved");
      expect(traceAfter!.approvalRespondedBy).toBe("reviewer_1");
      expect(traceAfter!.outcome).toBe("completed");
    });

    it("rejection updates WorkTrace outcome to failed", async () => {
      const spec = await app.storageContext.identity.getSpecByPrincipalId("default");
      if (spec) {
        spec.riskTolerance = {
          ...spec.riskTolerance,
          medium: "standard" as const,
          high: "elevated" as const,
        };
        await app.storageContext.identity.saveSpec(spec);
      }

      const proposeRes = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: { "Idempotency-Key": `truth-4-${Date.now()}` },
        payload: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_reject" },
          principalId: "default",
          organizationId: "org_test",
          cartridgeId: "digital-ads",
        },
      });

      const proposeBody = proposeRes.json();
      expect(proposeBody.outcome).toBe("PENDING_APPROVAL");

      await app.inject({
        method: "POST",
        url: `/api/approvals/${proposeBody.approvalRequest.id}/respond`,
        payload: {
          action: "reject",
          respondedBy: "reviewer_1",
        },
      });

      const traceStore = (
        app.platformIngress as unknown as {
          config: {
            traceStore: {
              getByWorkUnitId: (id: string) => Promise<{ trace: Record<string, unknown> } | null>;
            };
          };
        }
      ).config.traceStore;
      const traceResult = await traceStore.getByWorkUnitId(proposeBody.workUnitId);
      const trace = traceResult?.trace ?? null;
      expect(trace).not.toBeNull();
      expect(trace!.approvalOutcome).toBe("rejected");
      expect(trace!.outcome).toBe("failed");
    });

    it("undo creates a child WorkTrace linked to parent", async () => {
      const proposeRes = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        headers: { "Idempotency-Key": `truth-5-${Date.now()}` },
        payload: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_undo" },
          principalId: "default",
          organizationId: "org_test",
          cartridgeId: "digital-ads",
        },
      });

      const proposeBody = proposeRes.json();
      expect(proposeBody.outcome).toBe("EXECUTED");
      const parentId = proposeBody.workUnitId;

      // Create a legacy envelope with undo recipe for the undo test
      const now = new Date();
      await app.storageContext.envelopes.save({
        id: parentId,
        version: 1,
        incomingMessage: null,
        conversationId: null,
        proposals: [
          {
            id: `prop_${parentId}`,
            actionType: "digital-ads.campaign.pause",
            parameters: {
              campaignId: "camp_undo",
              _principalId: "default",
              _organizationId: "org_test",
            },
            evidence: "test",
            confidence: 1.0,
            originatingMessageId: "",
          },
        ],
        resolvedEntities: [],
        plan: null,
        decisions: [],
        approvalRequests: [],
        executionResults: [
          {
            actionId: `prop_${parentId}`,
            envelopeId: parentId,
            success: true,
            summary: "Executed",
            externalRefs: {},
            rollbackAvailable: true,
            partialFailures: [],
            durationMs: 10,
            executedAt: now,
            undoRecipe: {
              originalActionId: `prop_${parentId}`,
              originalEnvelopeId: parentId,
              reverseActionType: "digital-ads.campaign.resume",
              reverseParameters: { campaignId: "camp_undo" },
              undoExpiresAt: new Date(Date.now() + 86400000),
              undoRiskCategory: "medium",
              undoApprovalRequired: "none",
            },
          },
        ],
        auditEntryIds: [],
        status: "executed",
        createdAt: now,
        updatedAt: now,
        parentEnvelopeId: null,
        traceId: "trace_undo",
      });

      const undoRes = await app.inject({
        method: "POST",
        url: `/api/actions/${parentId}/undo`,
      });

      expect(undoRes.statusCode).toBe(201);
      const undoBody = undoRes.json();
      expect(undoBody.undoSubmitted).toBe(true);

      const traceStore = (
        app.platformIngress as unknown as {
          config: {
            traceStore: {
              getByWorkUnitId: (id: string) => Promise<{ trace: Record<string, unknown> } | null>;
            };
          };
        }
      ).config.traceStore;
      const childTraceResult = await traceStore.getByWorkUnitId(undoBody.undoWorkUnitId);
      const childTrace = childTraceResult?.trace ?? null;
      expect(childTrace).not.toBeNull();
      expect(childTrace!.parentWorkUnitId).toBe(parentId);
      expect(childTrace!.intent).toBe("digital-ads.campaign.resume");
    });
  });
});
