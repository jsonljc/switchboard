import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createApiOrchestrator,
  createApiStorage,
  createApiGovernanceProfileStore,
  createApiLedger,
} from "../adapters/api-governance-adapter.js";
import type { McpApiClient } from "../api-client.js";

// ── Mock Client ────────────────────────────────────────────────────────

function createMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    idempotencyKey: vi.fn(() => "test-key"),
  } as unknown as McpApiClient;
}

// ── createApiOrchestrator ──────────────────────────────────────────────

describe("createApiOrchestrator", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  describe("simulate", () => {
    it("posts to /api/simulate with correct payload and returns decisionTrace", async () => {
      const trace = { finalDecision: "allow", checks: [] };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: { decisionTrace: trace },
      });

      const orch = createApiOrchestrator(client);
      const result = await orch.simulate({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(client.post).toHaveBeenCalledWith("/api/simulate", {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        actorId: "user_1",
        cartridgeId: "digital-ads",
      });
      expect(result).toEqual({ decisionTrace: trace });
    });

    it("wraps raw response in decisionTrace if not already present", async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: { finalDecision: "deny" },
      });

      const orch = createApiOrchestrator(client);
      const result = await orch.simulate({
        actionType: "test",
        parameters: {},
        principalId: "u1",
        cartridgeId: "c1",
      });

      expect(result).toEqual({ decisionTrace: { finalDecision: "deny" } });
    });
  });

  describe("requestUndo", () => {
    it("posts to /api/actions/{id}/undo", async () => {
      const undoResult = { success: true };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: undoResult,
      });

      const orch = createApiOrchestrator(client);
      const result = await orch.requestUndo("env_123");

      expect(client.post).toHaveBeenCalledWith("/api/actions/env_123/undo", {});
      expect(result).toEqual(undoResult);
    });
  });

  describe("executeApproved", () => {
    it("posts to /api/actions/{id}/execute and returns .result", async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: { result: { success: true, summary: "Executed" } },
      });

      const orch = createApiOrchestrator(client);
      const result = await orch.executeApproved("env_456");

      expect(client.post).toHaveBeenCalledWith("/api/actions/env_456/execute", {});
      expect(result).toEqual({ success: true, summary: "Executed" });
    });

    it("returns full data when .result is not present", async () => {
      const fullData = { success: true, id: "env_789" };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: fullData,
      });

      const orch = createApiOrchestrator(client);
      const result = await orch.executeApproved("env_789");

      expect(result).toEqual(fullData);
    });
  });

  describe("propose", () => {
    it("posts to /api/execute with correct envelope construction", async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: {
          outcome: "PENDING_APPROVAL",
          envelopeId: "env_prop_1",
          traceId: "trace_prop_1",
          approvalRequest: { id: "apr_1", summary: "Needs review" },
        },
      });

      const orch = createApiOrchestrator(client);
      const result = await orch.propose({
        principalId: "user_1",
        organizationId: "org_1",
        actionType: "digital-ads.budget.adjust",
        parameters: { amount: 5000 },
        message: "Budget increase",
      });

      expect(client.post).toHaveBeenCalledWith(
        "/api/execute",
        {
          actorId: "user_1",
          organizationId: "org_1",
          action: {
            actionType: "digital-ads.budget.adjust",
            parameters: { amount: 5000 },
            sideEffect: true,
          },
          message: "Budget increase",
          emergencyOverride: false,
        },
        "test-key",
      );

      expect(result.envelope).toBeDefined();
      expect(result.envelope.id).toBe("env_prop_1");
      expect(result.envelope.status).toBe("pending_approval");
      expect(result.envelope.proposals![0]!.status).toBe("proposed");
      expect(result.decisionTrace).toBeDefined();
      expect(result.decisionTrace!.finalDecision).toBe("allow");
      expect(result.decisionTrace!.approvalRequired).toBe("standard");
      expect(result.approvalRequest).toEqual({ id: "apr_1", summary: "Needs review" });
      expect(result.denied).toBe(false);
    });

    it("maps DENIED outcome correctly", async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: {
          outcome: "DENIED",
          envelopeId: "env_denied",
          deniedExplanation: "Policy violation",
        },
      });

      const orch = createApiOrchestrator(client);
      const result = await orch.propose({
        principalId: "u1",
        actionType: "test",
        parameters: {},
      });

      expect(result.denied).toBe(true);
      expect(result.envelope.status).toBe("denied");
      expect(result.envelope.proposals![0]!.status).toBe("denied");
      expect(result.decisionTrace!.finalDecision).toBe("deny");
      expect(result.explanation).toBe("Policy violation");
    });

    it("maps EXECUTED outcome (approved) correctly", async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: {
          outcome: "EXECUTED",
          envelopeId: "env_exec",
          traceId: "t_exec",
        },
      });

      const orch = createApiOrchestrator(client);
      const result = await orch.propose({
        principalId: "u1",
        actionType: "test",
        parameters: {},
      });

      expect(result.denied).toBe(false);
      expect(result.envelope.status).toBe("approved");
      expect(result.decisionTrace!.approvalRequired).toBe("none");
    });

    it("passes emergencyOverride when set", async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: { outcome: "EXECUTED", envelopeId: "env_em" },
      });

      const orch = createApiOrchestrator(client);
      await orch.propose({
        principalId: "u1",
        actionType: "test",
        parameters: {},
        emergencyOverride: true,
      });

      const postedBody = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]![1];
      expect(postedBody.emergencyOverride).toBe(true);
    });
  });
});

// ── createApiStorage ───────────────────────────────────────────────────

describe("createApiStorage", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  describe("approvals.getById", () => {
    it("GETs approval and maps response", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: {
          id: "apr_1",
          summary: "High risk",
          riskCategory: "high",
          expiresAt: "2026-04-01T00:00:00.000Z",
          respondedBy: "reviewer_1",
          status: "approved",
          envelopeId: "env_1",
          organizationId: "org_1",
        },
      });

      const storage = createApiStorage(client);
      const result = await storage.approvals.getById("apr_1");

      expect(client.get).toHaveBeenCalledWith("/api/approvals/apr_1");
      expect(result).not.toBeNull();
      expect(result!.request.id).toBe("apr_1");
      expect(result!.request.summary).toBe("High risk");
      expect(result!.request.riskCategory).toBe("high");
      expect(result!.request.expiresAt).toBeInstanceOf(Date);
      expect(result!.request.respondedBy).toBe("reviewer_1");
      expect(result!.state.status).toBe("approved");
      expect(result!.envelopeId).toBe("env_1");
      expect(result!.organizationId).toBe("org_1");
    });

    it("returns null on 404", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 404,
        data: {},
      });

      const storage = createApiStorage(client);
      const result = await storage.approvals.getById("nonexistent");

      expect(result).toBeNull();
    });

    it("uses defaults for missing fields", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: {},
      });

      const storage = createApiStorage(client);
      const result = await storage.approvals.getById("apr_sparse");

      expect(result!.request.id).toBe("apr_sparse");
      expect(result!.request.summary).toBe("");
      expect(result!.request.riskCategory).toBe("low");
      expect(result!.request.respondedBy).toBeNull();
      expect(result!.state.status).toBe("pending");
      expect(result!.envelopeId).toBe("");
      expect(result!.organizationId).toBeNull();
    });
  });

  describe("approvals.listPending", () => {
    it("GETs pending approvals without org filter", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: {
          approvals: [
            {
              id: "apr_1",
              summary: "Action A",
              riskCategory: "high",
              status: "pending",
              envelopeId: "env_1",
            },
          ],
        },
      });

      const storage = createApiStorage(client);
      const result = await storage.approvals.listPending();

      expect(client.get).toHaveBeenCalledWith("/api/approvals/pending");
      expect(result).toHaveLength(1);
      expect(result[0]!.request.id).toBe("apr_1");
      expect(result[0]!.state.status).toBe("pending");
    });

    it("GETs pending approvals with org filter", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: { approvals: [] },
      });

      const storage = createApiStorage(client);
      await storage.approvals.listPending("org_1");

      expect(client.get).toHaveBeenCalledWith("/api/approvals/pending?organizationId=org_1");
    });

    it("returns empty array when no approvals key in response", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: {},
      });

      const storage = createApiStorage(client);
      const result = await storage.approvals.listPending();

      expect(result).toEqual([]);
    });
  });

  describe("envelopes.getById", () => {
    it("GETs envelope by id", async () => {
      const envelopeData = { id: "env_1", status: "approved" };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: envelopeData,
      });

      const storage = createApiStorage(client);
      const result = await storage.envelopes.getById("env_1");

      expect(client.get).toHaveBeenCalledWith("/api/actions/env_1");
      expect(result).toEqual(envelopeData);
    });

    it("returns null on 404", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 404,
        data: {},
      });

      const storage = createApiStorage(client);
      const result = await storage.envelopes.getById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("cartridges.get", () => {
    it("always returns undefined", () => {
      const storage = createApiStorage(client);
      expect(storage.cartridges.get("digital-ads")).toBeUndefined();
      expect(storage.cartridges.get("anything")).toBeUndefined();
    });
  });

  describe("cartridges.list", () => {
    it("returns the four built-in cartridge names", () => {
      const storage = createApiStorage(client);
      expect(storage.cartridges.list()).toEqual([
        "digital-ads",
        "payments",
        "crm",
        "customer-engagement",
      ]);
    });
  });
});

// ── createApiGovernanceProfileStore ─────────────────────────────────────

describe("createApiGovernanceProfileStore", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  describe("get", () => {
    it("returns 'guarded' for null organizationId without API call", async () => {
      const store = createApiGovernanceProfileStore(client);
      const result = await store.get(null);

      expect(result).toBe("guarded");
      expect(client.get).not.toHaveBeenCalled();
    });

    it("calls GET /api/governance/{orgId}/status for non-null orgId", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: { profile: "observe" },
      });

      const store = createApiGovernanceProfileStore(client);
      const result = await store.get("org_1");

      expect(client.get).toHaveBeenCalledWith("/api/governance/org_1/status");
      expect(result).toBe("observe");
    });

    it("defaults to 'guarded' when API response has no profile", async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: {},
      });

      const store = createApiGovernanceProfileStore(client);
      const result = await store.get("org_2");

      expect(result).toBe("guarded");
    });
  });

  describe("set", () => {
    it("is a no-op for null organizationId", async () => {
      const store = createApiGovernanceProfileStore(client);
      await store.set(null, "observe" as any);

      expect(client.put).not.toHaveBeenCalled();
    });

    it("calls PUT /api/governance/{orgId}/profile for non-null orgId", async () => {
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 200,
        data: {},
      });

      const store = createApiGovernanceProfileStore(client);
      await store.set("org_1", "enforce" as any);

      expect(client.put).toHaveBeenCalledWith("/api/governance/org_1/profile", {
        profile: "enforce",
      });
    });
  });
});

// ── createApiLedger ────────────────────────────────────────────────────

describe("createApiLedger", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("builds URLSearchParams and calls GET /api/audit", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: {
        entries: [
          {
            id: "entry_1",
            eventType: "action_executed",
            timestamp: "2026-03-01T10:00:00.000Z",
            actorId: "user_1",
            entityType: "campaign",
            entityId: "camp_1",
            riskCategory: "high",
            summary: "Campaign paused",
            envelopeId: "env_1",
          },
        ],
      },
    });

    const ledger = createApiLedger(client);
    const result = await ledger.query({
      envelopeId: "env_1",
      entityId: "camp_1",
      eventType: "action_executed",
      organizationId: "org_1",
      limit: 10,
    });

    const calledPath = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledPath).toContain("/api/audit?");
    expect(calledPath).toContain("envelopeId=env_1");
    expect(calledPath).toContain("entityId=camp_1");
    expect(calledPath).toContain("eventType=action_executed");
    expect(calledPath).toContain("organizationId=org_1");
    expect(calledPath).toContain("limit=10");

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("entry_1");
    expect(result[0]!.timestamp).toBeInstanceOf(Date);
    expect(result[0]!.timestamp.toISOString()).toBe("2026-03-01T10:00:00.000Z");
  });

  it("converts Date filter values to ISO strings", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: { entries: [] },
    });

    const afterDate = new Date("2026-01-01T00:00:00.000Z");
    const beforeDate = new Date("2026-02-01T00:00:00.000Z");

    const ledger = createApiLedger(client);
    await ledger.query({ after: afterDate, before: beforeDate });

    const calledPath = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledPath).toContain("after=2026-01-01T00%3A00%3A00.000Z");
    expect(calledPath).toContain("before=2026-02-01T00%3A00%3A00.000Z");
  });

  it("passes string date values as-is", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: { entries: [] },
    });

    const ledger = createApiLedger(client);
    await ledger.query({ after: "2026-01-01", before: "2026-02-01" });

    const calledPath = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledPath).toContain("after=2026-01-01");
    expect(calledPath).toContain("before=2026-02-01");
  });

  it("returns empty array when no entries in response", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: {},
    });

    const ledger = createApiLedger(client);
    const result = await ledger.query({});

    expect(result).toEqual([]);
  });

  it("omits filter keys that are falsy", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: { entries: [] },
    });

    const ledger = createApiLedger(client);
    await ledger.query({ envelopeId: "env_1" });

    const calledPath = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledPath).toContain("envelopeId=env_1");
    expect(calledPath).not.toContain("entityId");
    expect(calledPath).not.toContain("eventType");
    expect(calledPath).not.toContain("organizationId");
  });
});
