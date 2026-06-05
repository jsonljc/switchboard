import { describe, expect, it, vi } from "vitest";
import {
  HttpApprovalRespondTransport,
  BridgeTransportError,
} from "../http-approval-respond-transport.js";
import type { ChannelApprovalRespondRequest } from "../respond-to-channel-approval.js";

const REQUEST: ChannelApprovalRespondRequest = {
  approvalId: "appr_1",
  action: "approve",
  bindingHash: "hash123",
  organizationId: "org-1",
  channel: "whatsapp",
  channelIdentifier: "+6591234567",
};

const OUTCOME = { kind: "responded", action: "approve", executionSuccess: true };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function transportWith(fetchImpl: typeof fetch) {
  return new HttpApprovalRespondTransport({
    baseUrl: "http://api.test",
    internalApiSecret: "s3cret",
    fetchImpl,
    retryDelayMs: 1,
    timeoutMs: 50,
  });
}

describe("HttpApprovalRespondTransport", () => {
  it("POSTs the request to the internal route with the bearer secret", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OUTCOME));
    const outcome = await transportWith(fetchImpl as never).respond(REQUEST);
    expect(outcome).toEqual(OUTCOME);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/api/internal/chat-approvals/respond");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer s3cret");
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  it("passes refusal outcomes through without retrying", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ kind: "refused", code: "stale" }));
    const outcome = await transportWith(fetchImpl as never).respond(REQUEST);
    expect(outcome).toEqual({ kind: "refused", code: "stale" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries once on network error, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(jsonResponse(OUTCOME));
    const outcome = await transportWith(fetchImpl as never).respond(REQUEST);
    expect(outcome).toEqual(OUTCOME);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries once on 503, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "x" }, 503))
      .mockResolvedValueOnce(jsonResponse(OUTCOME));
    const outcome = await transportWith(fetchImpl as never).respond(REQUEST);
    expect(outcome).toEqual(OUTCOME);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws after the retry is exhausted", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(transportWith(fetchImpl as never).respond(REQUEST)).rejects.toBeInstanceOf(
      BridgeTransportError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 404, 429])("does not retry on %s", async (status) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "x" }, status));
    await expect(transportWith(fetchImpl as never).respond(REQUEST)).rejects.toBeInstanceOf(
      BridgeTransportError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed outcomes (unknown code) without retry", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ kind: "refused", code: "brand_new" }));
    await expect(transportWith(fetchImpl as never).respond(REQUEST)).rejects.toBeInstanceOf(
      BridgeTransportError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects non-JSON bodies without retry", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 200 }));
    await expect(transportWith(fetchImpl as never).respond(REQUEST)).rejects.toBeInstanceOf(
      BridgeTransportError,
    );
  });

  it("timeout-after-server-commit: retry surfaces already_responded (spec 3.2 accepted UX)", async () => {
    // Attempt 1 dies on the wire AFTER the server committed; attempt 2 sees the
    // committed state. The conservative "already handled" outcome passes through.
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(jsonResponse({ kind: "refused", code: "already_responded" }));
    const outcome = await transportWith(fetchImpl as never).respond(REQUEST);
    expect(outcome).toEqual({ kind: "refused", code: "already_responded" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed without ever fetching when unconfigured", async () => {
    const fetchImpl = vi.fn();
    const transport = new HttpApprovalRespondTransport({
      baseUrl: "",
      internalApiSecret: "",
      fetchImpl: fetchImpl as never,
    });
    await expect(transport.respond(REQUEST)).rejects.toBeInstanceOf(BridgeTransportError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
