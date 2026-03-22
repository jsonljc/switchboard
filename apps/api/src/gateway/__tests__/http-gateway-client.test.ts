import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpGatewayClient } from "../http-gateway-client.js";
import {
  GatewayInvocationAbortedError,
  GatewayInvalidResponseError,
  GatewayRejectedAuthError,
  GatewayTimeoutError,
  GatewayTransportError,
} from "../gateway-errors.js";

const sessionId = "550e8400-e29b-41d4-a716-446655440001";
const runId = "550e8400-e29b-41d4-a716-446655440002";
const traceId = "trace-1";

const minimalInitialBody = {
  kind: "initial" as const,
  sessionId,
  runId,
  roleId: "role-a",
  sessionToken: "tok",
  traceId,
  idempotencyKey: "k1",
  instruction: "do the thing",
  allowedToolPack: ["t1"],
  governanceProfile: "strict",
  safetyLimits: {
    sessionTimeoutMs: 60_000,
    maxToolCalls: 10,
    maxMutations: 2,
    maxDollarsAtRisk: 100,
  },
};

const validInvokeJson = JSON.stringify({
  status: "completed",
  result: {},
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HttpGatewayClient", () => {
  it("sends Authorization and X-Switchboard-Trace-Id on invoke", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(validInvokeJson, { status: 200 }));
    const client = new HttpGatewayClient({
      baseUrl: "http://gateway.test",
      maxRetries: 0,
      fetchFn: fetchMock as typeof fetch,
    });
    await client.invokeInitial(minimalInitialBody);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://gateway.test/invoke",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tok",
          "X-Switchboard-Trace-Id": traceId,
        }),
      }),
    );
  });

  it("throws GatewayInvocationAbortedError when invocation signal aborts", async () => {
    const ac = new AbortController();
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const sig = init?.signal;
      if (!sig) {
        return Promise.resolve(new Response(validInvokeJson, { status: 200 }));
      }
      return new Promise<Response>((_resolve, reject) => {
        sig.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const client = new HttpGatewayClient({
      baseUrl: "http://gateway.test",
      maxRetries: 0,
      fetchTimeoutMs: 60_000,
      fetchFn: fetchMock as typeof fetch,
    });
    const p = client.invokeInitial(minimalInitialBody, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow(GatewayInvocationAbortedError);
  });

  it("merges correlation ids from response headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", result: {} }), {
        status: 200,
        headers: {
          "x-request-id": "gw-req-7",
          "x-openclaw-correlation-id": "oc-8",
        },
      }),
    );
    const client = new HttpGatewayClient({
      baseUrl: "http://gateway.test",
      maxRetries: 0,
      fetchFn: fetchMock as typeof fetch,
    });
    const r = await client.invokeInitial(minimalInitialBody);
    expect(r.correlation).toEqual({
      gatewayRequestId: "gw-req-7",
      runtimeCorrelationId: "oc-8",
    });
  });

  it("throws GatewayInvalidResponseError for non-JSON invoke body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("not-json", { status: 200, headers: { "Content-Type": "text/plain" } }),
        ),
    );
    const client = new HttpGatewayClient({ baseUrl: "http://gateway.test", maxRetries: 0 });
    await expect(client.invokeInitial(minimalInitialBody)).rejects.toThrow(
      GatewayInvalidResponseError,
    );
  });

  it("throws GatewayInvalidResponseError for schema-invalid JSON invoke body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ status: "unknown" }), { status: 200 })),
    );
    const client = new HttpGatewayClient({ baseUrl: "http://gateway.test", maxRetries: 0 });
    await expect(client.invokeInitial(minimalInitialBody)).rejects.toThrow(
      GatewayInvalidResponseError,
    );
  });

  it("throws GatewayRejectedAuthError on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })),
    );
    const client = new HttpGatewayClient({ baseUrl: "http://gateway.test", maxRetries: 0 });
    await expect(client.invokeInitial(minimalInitialBody)).rejects.toThrow(
      GatewayRejectedAuthError,
    );
  });

  it("retries transport-class failures then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(new Response(validInvokeJson, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpGatewayClient({
      baseUrl: "http://gateway.test",
      maxRetries: 2,
      retryDelayMs: 1,
    });
    const res = await client.invokeInitial(minimalInitialBody);
    expect(res.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps abort to GatewayTimeoutError after retries exhausted", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(err);
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpGatewayClient({
      baseUrl: "http://gateway.test",
      maxRetries: 1,
      retryDelayMs: 1,
      fetchTimeoutMs: 50_000,
    });
    await expect(client.invokeInitial(minimalInitialBody)).rejects.toThrow(GatewayTimeoutError);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("healthCheck wraps Zod failures as GatewayInvalidResponseError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );
    const client = new HttpGatewayClient({ baseUrl: "http://gateway.test", maxRetries: 0 });
    await expect(client.healthCheck()).rejects.toThrow(GatewayInvalidResponseError);
  });

  it("throws GatewayTransportError on HTTP 500 (retry path)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 500 })));
    const client = new HttpGatewayClient({ baseUrl: "http://gateway.test", maxRetries: 0 });
    await expect(client.invokeInitial(minimalInitialBody)).rejects.toThrow(GatewayTransportError);
  });
});
