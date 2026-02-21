import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";
import type { TestCartridge } from "@switchboard/cartridge-sdk";

describe("API Lifecycle (End-to-End)", () => {
  let app: FastifyInstance;
  let cartridge: TestCartridge;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;
    cartridge = ctx.cartridge;
  });

  afterEach(async () => {
    await app.close();
  });

  it("full lifecycle: propose → approve → execute → verify audit", async () => {
    // 1. Propose (high risk → needs approval)
    const proposeRes = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      payload: {
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_lifecycle" },
        principalId: "default",
        cartridgeId: "ads-spend",
      },
    });

    expect(proposeRes.statusCode).toBe(201);
    const proposeBody = proposeRes.json();
    expect(proposeBody.envelope.status).toBe("pending_approval");
    expect(proposeBody.approvalRequest).toBeDefined();

    const envelopeId = proposeBody.envelope.id;
    const approvalId = proposeBody.approvalRequest.id;
    const bindingHash = proposeBody.approvalRequest.bindingHash;

    // 2. Approve
    const approveRes = await app.inject({
      method: "POST",
      url: `/api/approvals/${approvalId}/respond`,
      payload: {
        action: "approve",
        respondedBy: "reviewer_1",
        bindingHash,
      },
    });

    expect(approveRes.statusCode).toBe(200);
    const approveBody = approveRes.json();
    expect(approveBody.envelope.status).toBe("executed");
    expect(approveBody.executionResult).toBeDefined();
    expect(approveBody.executionResult.success).toBe(true);

    // 3. Verify envelope state
    const getRes = await app.inject({
      method: "GET",
      url: `/api/actions/${envelopeId}`,
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().envelope.status).toBe("executed");

    // 4. Verify audit chain
    const auditRes = await app.inject({
      method: "GET",
      url: "/api/audit/verify",
    });

    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().valid).toBe(true);
    expect(auditRes.json().entriesChecked).toBeGreaterThanOrEqual(3); // proposed, approved, executed

    // 5. Verify audit entries exist for this envelope
    const auditQueryRes = await app.inject({
      method: "GET",
      url: `/api/audit?envelopeId=${envelopeId}`,
    });

    expect(auditQueryRes.statusCode).toBe(200);
    expect(auditQueryRes.json().entries.length).toBeGreaterThanOrEqual(3);
  });

  it("lifecycle with undo: execute → undo → verify parent chain", async () => {
    // Use low risk for auto-approval
    cartridge.onRiskInput(() => ({
      baseRisk: "low" as const,
      exposure: { dollarsAtRisk: 10, blastRadius: 1 },
      reversibility: "full" as const,
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    }));

    // 1. Propose (auto-approved)
    const proposeRes = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      payload: {
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_undo" },
        principalId: "default",
        cartridgeId: "ads-spend",
      },
    });

    expect(proposeRes.json().envelope.status).toBe("approved");
    const envelopeId = proposeRes.json().envelope.id;

    // 2. Execute
    const execRes = await app.inject({
      method: "POST",
      url: `/api/actions/${envelopeId}/execute`,
    });

    expect(execRes.statusCode).toBe(200);
    expect(execRes.json().result.success).toBe(true);

    // 3. Undo
    const undoRes = await app.inject({
      method: "POST",
      url: `/api/actions/${envelopeId}/undo`,
    });

    expect(undoRes.statusCode).toBe(201);
    const undoBody = undoRes.json();
    expect(undoBody.envelope).toBeDefined();
    expect(undoBody.envelope.parentEnvelopeId).toBe(envelopeId);

    // 4. Verify audit chain still valid
    const auditRes = await app.inject({
      method: "GET",
      url: "/api/audit/verify",
    });

    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().valid).toBe(true);
  });

  it("health check returns ok", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });
});
