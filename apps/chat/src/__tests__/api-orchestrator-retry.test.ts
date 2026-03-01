import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ApiOrchestratorAdapter } from "../api-orchestrator-adapter.js";

describe("ApiOrchestratorAdapter retry logic", () => {
  let fetchCalls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    fetchCalls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds on first attempt without retry", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          outcome: "EXECUTED",
          envelopeId: "env_1",
          traceId: "trace_1",
          executionResult: { success: true, summary: "Done", rollbackAvailable: false, partialFailures: [], durationMs: 10, externalRefs: {} },
        }),
      };
    });

    const adapter = new ApiOrchestratorAdapter({ baseUrl: "http://localhost:3000" });
    const result = await adapter.resolveAndPropose({
      actionType: "ads.campaign.pause",
      parameters: { campaignId: "camp_1" },
      principalId: "user_1",
      cartridgeId: "ads-spend",
      entityRefs: [],
      message: "pause campaign",
    });

    expect(fetchCalls).toHaveLength(1);
    expect("needsClarification" in result).toBe(false);
    expect("notFound" in result).toBe(false);
  });

  it("retries on 500 and succeeds on second attempt", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      attempt++;
      if (attempt === 1) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          outcome: "EXECUTED",
          envelopeId: "env_1",
          traceId: "trace_1",
          executionResult: { success: true, summary: "Done", rollbackAvailable: false, partialFailures: [], durationMs: 10, externalRefs: {} },
        }),
      };
    });

    const adapter = new ApiOrchestratorAdapter({ baseUrl: "http://localhost:3000" });
    const result = await adapter.resolveAndPropose({
      actionType: "ads.campaign.pause",
      parameters: {},
      principalId: "user_1",
      cartridgeId: "ads-spend",
      entityRefs: [],
      message: "pause",
    });

    expect(fetchCalls.length).toBeGreaterThanOrEqual(2);
    expect("needsClarification" in result).toBe(false);
  });

  it("retries on 429 (rate limited)", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      attempt++;
      if (attempt === 1) {
        return { ok: false, status: 429, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          outcome: "EXECUTED",
          envelopeId: "env_1",
          traceId: "trace_1",
          executionResult: { success: true, summary: "Done", rollbackAvailable: false, partialFailures: [], durationMs: 10, externalRefs: {} },
        }),
      };
    });

    const adapter = new ApiOrchestratorAdapter({ baseUrl: "http://localhost:3000" });
    const result = await adapter.resolveAndPropose({
      actionType: "ads.campaign.pause",
      parameters: {},
      principalId: "user_1",
      cartridgeId: "ads-spend",
      entityRefs: [],
      message: "pause",
    });

    expect(fetchCalls.length).toBeGreaterThanOrEqual(2);
    expect("needsClarification" in result).toBe(false);
  });

  it("does NOT retry on 422 (clarification needed)", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return {
        ok: false,
        status: 422,
        json: async () => ({ question: "Which campaign?" }),
      };
    });

    const adapter = new ApiOrchestratorAdapter({ baseUrl: "http://localhost:3000" });
    const result = await adapter.resolveAndPropose({
      actionType: "ads.campaign.pause",
      parameters: {},
      principalId: "user_1",
      cartridgeId: "ads-spend",
      entityRefs: [],
      message: "pause",
    });

    expect(fetchCalls).toHaveLength(1);
    expect("needsClarification" in result && result.needsClarification).toBe(true);
  });

  it("does NOT retry on 404 (not found)", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return {
        ok: false,
        status: 404,
        json: async () => ({ explanation: "Campaign not found" }),
      };
    });

    const adapter = new ApiOrchestratorAdapter({ baseUrl: "http://localhost:3000" });
    const result = await adapter.resolveAndPropose({
      actionType: "ads.campaign.pause",
      parameters: {},
      principalId: "user_1",
      cartridgeId: "ads-spend",
      entityRefs: [],
      message: "pause",
    });

    expect(fetchCalls).toHaveLength(1);
    expect("notFound" in result && result.notFound).toBe(true);
  });

  it("throws after exhausting all retry attempts on 500", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return { ok: false, status: 500, json: async () => ({}) };
    });

    const adapter = new ApiOrchestratorAdapter({ baseUrl: "http://localhost:3000" });
    await expect(
      adapter.resolveAndPropose({
        actionType: "ads.campaign.pause",
        parameters: {},
        principalId: "user_1",
        cartridgeId: "ads-spend",
        entityRefs: [],
        message: "pause",
      }),
    ).rejects.toThrow("HTTP 500");

    // Should have attempted 3 times (default maxAttempts)
    expect(fetchCalls).toHaveLength(3);
  });

  it("retries on network errors (fetch throws)", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      attempt++;
      if (attempt < 3) {
        throw new Error("Network error");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          outcome: "EXECUTED",
          envelopeId: "env_1",
          traceId: "trace_1",
          executionResult: { success: true, summary: "Done", rollbackAvailable: false, partialFailures: [], durationMs: 10, externalRefs: {} },
        }),
      };
    });

    const adapter = new ApiOrchestratorAdapter({ baseUrl: "http://localhost:3000" });
    const result = await adapter.resolveAndPropose({
      actionType: "ads.campaign.pause",
      parameters: {},
      principalId: "user_1",
      cartridgeId: "ads-spend",
      entityRefs: [],
      message: "pause",
    });

    expect(fetchCalls).toHaveLength(3);
    expect("needsClarification" in result).toBe(false);
  });

  describe("executeApproved", () => {
    it("sends idempotency key with execute request", async () => {
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            result: { success: true, summary: "Executed", rollbackAvailable: false, partialFailures: [], durationMs: 5, externalRefs: {} },
          }),
        };
      });

      const adapter = new ApiOrchestratorAdapter({ baseUrl: "http://localhost:3000" });
      await adapter.executeApproved("env_123");

      expect(fetchCalls).toHaveLength(1);
      const headers = fetchCalls[0]!.init?.headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBe("execute_env_123");
    });

    it("returns cached result without calling fetch", async () => {
      // First, do a resolveAndPropose that returns EXECUTED (which caches the result)
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            outcome: "EXECUTED",
            envelopeId: "env_cached",
            traceId: "trace_1",
            executionResult: { success: true, summary: "Cached result", rollbackAvailable: false, partialFailures: [], durationMs: 5, externalRefs: {} },
          }),
        };
      });

      const adapter = new ApiOrchestratorAdapter({ baseUrl: "http://localhost:3000" });
      await adapter.resolveAndPropose({
        actionType: "ads.campaign.pause",
        parameters: {},
        principalId: "user_1",
        cartridgeId: "ads-spend",
        entityRefs: [],
        message: "pause",
      });

      const callsBefore = fetchCalls.length;
      const result = await adapter.executeApproved("env_cached");
      // Should NOT have made another fetch call (used cache)
      expect(fetchCalls.length).toBe(callsBefore);
      expect(result.summary).toBe("Cached result");
    });

    it("retries executeApproved on 500", async () => {
      let attempt = 0;
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        attempt++;
        if (attempt === 1) {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            result: { success: true, summary: "Executed after retry", rollbackAvailable: false, partialFailures: [], durationMs: 5, externalRefs: {} },
          }),
        };
      });

      const adapter = new ApiOrchestratorAdapter({ baseUrl: "http://localhost:3000" });
      const result = await adapter.executeApproved("env_retry");

      expect(fetchCalls.length).toBeGreaterThanOrEqual(2);
      expect(result.summary).toBe("Executed after retry");
    });
  });
});
