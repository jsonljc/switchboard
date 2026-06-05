import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { WorkTrace } from "@switchboard/core/platform";
import { buildTestServer } from "./test-server.js";

describe("decisions feed: parked workflow approvals", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx = await buildTestServer({ lifecycle: true });
    app = ctx.app;
    const spec = await app.storageContext.identity.getSpecByPrincipalId("default");
    if (spec) {
      spec.riskTolerance = { ...spec.riskTolerance, medium: "standard" as const };
      await app.storageContext.identity.saveSpec(spec);
    }
  });

  afterEach(async () => {
    await app.close();
  });

  async function parkOne() {
    const res = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "Idempotency-Key": `park-${Date.now()}-${Math.random()}` },
      payload: {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_123" },
        principalId: "default",
        cartridgeId: "digital-ads",
        organizationId: "default",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.outcome).toBe("PENDING_APPROVAL");
    return body.approvalRequest as { id: string; bindingHash: string };
  }

  function makeBulkTrace(workUnitId: string): WorkTrace {
    return {
      workUnitId,
      traceId: `trace-${workUnitId}`,
      intent: "conversation.reminder.send",
      mode: "workflow",
      organizationId: "default",
      actor: { id: "system", type: "system" },
      trigger: "schedule",
      parameters: { contactId: "c-1" },
      governanceOutcome: "require_approval",
      riskScore: 0.3,
      matchedPolicies: [],
      outcome: "pending_approval",
      durationMs: 0,
      requestedAt: new Date().toISOString(),
      governanceCompletedAt: new Date().toISOString(),
      ingressPath: "platform_ingress",
      hashInputVersion: 2,
    } as WorkTrace;
  }

  it("surfaces a parked lifecycle as a workflow_approval decision with bindingHash", async () => {
    const approval = await parkOne();

    const res = await app.inject({ method: "GET", url: "/api/dashboard/decisions" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const card = body.decisions.find(
      (d: { kind: string; sourceRef: { sourceId: string } }) =>
        d.kind === "workflow_approval" && d.sourceRef.sourceId === approval.id,
    );
    expect(card).toBeDefined();
    expect(card.meta.bindingHash).toBe(approval.bindingHash);
    expect(card.humanSummary).toContain("digital-ads.campaign.pause");
    expect(card.agentKey).toBe("riley");
    expect(body.counts.approval).toBeGreaterThanOrEqual(1);
    expect(body.counts.total).toBeGreaterThanOrEqual(1);
  });

  it("keeps the feed working when lifecycleService is absent", async () => {
    const bare = await buildTestServer();
    const res = await bare.app.inject({ method: "GET", url: "/api/dashboard/decisions" });
    expect(res.statusCode).toBe(200);
    expect(res.json().decisions).toEqual([]);
    await bare.app.close();
  });

  it("sorts by expiry BEFORE capping so urgent approvals are never hidden (review #6)", async () => {
    const svc = app.lifecycleService!;
    for (let i = 0; i < 27; i++) {
      const wu = `wu-bulk-${i}`;
      await app.workTraceStore!.persist(makeBulkTrace(wu));
      await svc.createGatedLifecycle({
        actionEnvelopeId: wu,
        organizationId: "default",
        // i=26 expires in 1h (most urgent); the rest 48h+ out.
        expiresAt: new Date(Date.now() + (i === 26 ? 1 : 48 + i) * 3_600_000),
        initialRevision: {
          parametersSnapshot: {},
          approvalScopeSnapshot: {},
          bindingHash: `h-${i}`,
          createdBy: "system",
        },
      });
    }
    const res = await app.inject({ method: "GET", url: "/api/dashboard/decisions" });
    const cards = res
      .json()
      .decisions.filter((d: { kind: string }) => d.kind === "workflow_approval");
    expect(cards).toHaveLength(25);
    const urgent = cards.find(
      (c: { meta: { bindingHash?: string } }) => c.meta.bindingHash === "h-26",
    );
    expect(urgent).toBeDefined();
  });

  it("renders a degraded card when the trace is missing instead of skipping (review #5)", async () => {
    const svc = app.lifecycleService!;
    await svc.createGatedLifecycle({
      actionEnvelopeId: "wu-traceless",
      organizationId: "default",
      expiresAt: new Date(Date.now() + 3_600_000),
      initialRevision: {
        parametersSnapshot: {},
        approvalScopeSnapshot: {},
        bindingHash: "h-x",
        createdBy: "system",
      },
    });
    const res = await app.inject({ method: "GET", url: "/api/dashboard/decisions" });
    const card = res
      .json()
      .decisions.find((d: { humanSummary: string }) =>
        d.humanSummary.includes("could not be fully loaded"),
      );
    expect(card).toBeDefined();
  });

  it("surfaces recovery_required lifecycles as Retry cards", async () => {
    const approval = await parkOne();
    // Drive the lifecycle to recovery_required directly (the respond-path
    // transition is covered by api-approvals-lifecycle.test.ts).
    const svc = app.lifecycleService!;
    const lc = await svc.getLifecycleById(approval.id);
    await svc.transitionStatus(lc!, "recovery_required");

    const res = await app.inject({ method: "GET", url: "/api/dashboard/decisions" });
    const card = res
      .json()
      .decisions.find(
        (d: { sourceRef: { sourceId: string } }) => d.sourceRef.sourceId === approval.id,
      );
    expect(card).toBeDefined();
    expect(card.presentation.primaryLabel).toBe("Retry");
    expect(card.meta.dispatchFailed).toBe(true);
  });
});
