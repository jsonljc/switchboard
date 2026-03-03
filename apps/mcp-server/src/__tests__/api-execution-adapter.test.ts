import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiExecutionAdapter } from "../adapters/api-execution-adapter.js";
import type { McpApiClient } from "../api-client.js";
import type { RuntimeExecuteRequest } from "@switchboard/core";

// ── Mock Client ────────────────────────────────────────────────────────

function createMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    idempotencyKey: vi.fn(() => "mcp_exec_test-key"),
  } as unknown as McpApiClient;
}

function buildRequest(overrides: Partial<RuntimeExecuteRequest> = {}): RuntimeExecuteRequest {
  return {
    actorId: "user_1",
    organizationId: "org_1",
    requestedAction: {
      actionType: "digital-ads.campaign.pause",
      parameters: { campaignId: "camp_1" },
      sideEffect: true,
    },
    entityRefs: [{ inputRef: "camp_1", entityType: "campaign" }],
    message: "Pausing for maintenance",
    traceId: "trace_abc",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("ApiExecutionAdapter", () => {
  let client: ReturnType<typeof createMockClient>;
  let adapter: ApiExecutionAdapter;

  beforeEach(() => {
    client = createMockClient();
    adapter = new ApiExecutionAdapter(client);
  });

  // ── Payload Mapping ────────────────────────────────────────────────

  it("posts to /api/execute with correctly mapped payload", async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: {
        outcome: "EXECUTED",
        envelopeId: "env_1",
        traceId: "trace_abc",
        executionResult: { success: true, summary: "Done", externalRefs: {} },
      },
    });

    const request = buildRequest();
    await adapter.execute(request);

    expect(client.post).toHaveBeenCalledWith(
      "/api/execute",
      {
        actorId: "user_1",
        organizationId: "org_1",
        action: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_1" },
          sideEffect: true,
        },
        entityRefs: [{ inputRef: "camp_1", entityType: "campaign" }],
        message: "Pausing for maintenance",
        traceId: "trace_abc",
      },
      "mcp_exec_test-key",
    );
  });

  it("defaults sideEffect to true when not set", async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: { outcome: "EXECUTED", envelopeId: "env_1" },
    });

    const request = buildRequest({
      requestedAction: {
        actionType: "digital-ads.campaign.pause",
        parameters: {},
        sideEffect: true,
      },
    });
    await adapter.execute(request);

    const postedBody = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(postedBody.action.sideEffect).toBe(true);
  });

  // ── DENIED on 4xx ──────────────────────────────────────────────────

  it("returns DENIED response on HTTP 4xx", async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 403,
      data: { error: "Forbidden" },
    });

    const result = await adapter.execute(buildRequest());

    expect(result.outcome).toBe("DENIED");
    expect(result.envelopeId).toBe("");
    expect(result.deniedExplanation).toBe("Forbidden");
  });

  it("uses generic message when 4xx response has no error field", async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 422,
      data: {},
    });

    const result = await adapter.execute(buildRequest());

    expect(result.outcome).toBe("DENIED");
    expect(result.deniedExplanation).toBe("API error 422");
  });

  it("uses request traceId for DENIED response", async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 400,
      data: { error: "Bad request" },
    });

    const result = await adapter.execute(buildRequest({ traceId: "my-trace" }));

    expect(result.traceId).toBe("my-trace");
  });

  // ── Successful Outcomes ────────────────────────────────────────────

  it("maps EXECUTED response correctly", async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: {
        outcome: "EXECUTED",
        envelopeId: "env_99",
        traceId: "trace_99",
        executionResult: {
          success: true,
          summary: "Campaign paused",
          externalRefs: { campaignId: "camp_1" },
        },
      },
    });

    const result = await adapter.execute(buildRequest());

    expect(result.outcome).toBe("EXECUTED");
    expect(result.envelopeId).toBe("env_99");
    expect(result.traceId).toBe("trace_99");
    expect(result.executionResult).toEqual({
      success: true,
      summary: "Campaign paused",
      externalRefs: { campaignId: "camp_1" },
    });
    expect(result.approvalRequest).toBeUndefined();
    expect(result.deniedExplanation).toBeUndefined();
  });

  it("maps PENDING_APPROVAL response and converts expiresAt to Date", async () => {
    const expiresAtStr = "2026-03-10T12:00:00.000Z";
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: {
        outcome: "PENDING_APPROVAL",
        envelopeId: "env_200",
        traceId: "trace_200",
        approvalId: "appr_1",
        approvalRequest: {
          id: "appr_1",
          summary: "High risk action",
          riskCategory: "high",
          bindingHash: "hash_abc",
          expiresAt: expiresAtStr,
        },
      },
    });

    const result = await adapter.execute(buildRequest());

    expect(result.outcome).toBe("PENDING_APPROVAL");
    expect(result.approvalId).toBe("appr_1");
    expect(result.approvalRequest).toBeDefined();
    expect(result.approvalRequest!.id).toBe("appr_1");
    expect(result.approvalRequest!.summary).toBe("High risk action");
    expect(result.approvalRequest!.riskCategory).toBe("high");
    expect(result.approvalRequest!.bindingHash).toBe("hash_abc");
    expect(result.approvalRequest!.expiresAt).toBeInstanceOf(Date);
    expect((result.approvalRequest!.expiresAt as Date).toISOString()).toBe(expiresAtStr);
  });

  it("maps DENIED response from API", async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: {
        outcome: "DENIED",
        envelopeId: "env_denied",
        traceId: "trace_denied",
        deniedExplanation: "Policy violation",
      },
    });

    const result = await adapter.execute(buildRequest());

    expect(result.outcome).toBe("DENIED");
    expect(result.envelopeId).toBe("env_denied");
    expect(result.deniedExplanation).toBe("Policy violation");
  });

  it("falls back to request traceId when response traceId is missing", async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: {
        outcome: "EXECUTED",
        envelopeId: "env_no_trace",
        // no traceId in response
      },
    });

    const result = await adapter.execute(buildRequest({ traceId: "fallback-trace" }));

    expect(result.traceId).toBe("fallback-trace");
  });

  it("uses empty string traceId when neither response nor request has one", async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: {
        outcome: "EXECUTED",
        envelopeId: "env_empty_trace",
      },
    });

    const result = await adapter.execute(buildRequest({ traceId: undefined }));

    expect(result.traceId).toBe("");
  });
});
