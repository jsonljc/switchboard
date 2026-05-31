import { describe, it, expect, vi } from "vitest";
import type { FastifyReply } from "fastify";
import type { IngressError } from "@switchboard/core/platform";
import { ingressErrorToReply } from "../ingress-error-to-reply.js";

function mkReply(): {
  reply: FastifyReply;
  code: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn().mockReturnThis();
  const code = vi.fn().mockReturnValue({ send });
  const reply = { code } as unknown as FastifyReply;
  return { reply, code, send };
}

describe("ingressErrorToReply", () => {
  it("maps intent_not_found to 404", () => {
    const { reply, code, send } = mkReply();
    const err: IngressError = { type: "intent_not_found", intent: "x", message: "missing" };
    ingressErrorToReply(err, reply);
    expect(code).toHaveBeenCalledWith(404);
    expect(send).toHaveBeenCalledWith({ error: "missing", statusCode: 404 });
  });

  it("maps deployment_not_found to 404", () => {
    const { reply, code, send } = mkReply();
    const err: IngressError = { type: "deployment_not_found", intent: "x", message: "no dep" };
    ingressErrorToReply(err, reply);
    expect(code).toHaveBeenCalledWith(404);
    expect(send).toHaveBeenCalledWith({ error: "no dep", statusCode: 404 });
  });

  it("maps entitlement_required to 402 and surfaces blockedStatus", () => {
    const { reply, code, send } = mkReply();
    const err: IngressError = {
      type: "entitlement_required",
      intent: "x",
      message: "not entitled",
      blockedStatus: "trial_expired",
    };
    ingressErrorToReply(err, reply);
    expect(code).toHaveBeenCalledWith(402);
    expect(send).toHaveBeenCalledWith({
      error: "not entitled",
      statusCode: 402,
      blockedStatus: "trial_expired",
    });
  });

  it.each(["trigger_not_allowed", "validation_failed", "upstream_error", "network_error"] as const)(
    "maps %s to 400",
    (type) => {
      const { reply, code, send } = mkReply();
      const err: IngressError = { type, intent: "x", message: "bad" };
      ingressErrorToReply(err, reply);
      expect(code).toHaveBeenCalledWith(400);
      expect(send).toHaveBeenCalledWith({ error: "bad", statusCode: 400 });
    },
  );

  it("maps idempotency_in_flight to 409 and surfaces retryable=false", () => {
    const { reply, code, send } = mkReply();
    const err: IngressError = {
      type: "idempotency_in_flight",
      intent: "x",
      message: "unresolved prior attempt",
      retryable: false,
    };
    ingressErrorToReply(err, reply);
    expect(code).toHaveBeenCalledWith(409);
    expect(send).toHaveBeenCalledWith({
      error: "unresolved prior attempt",
      statusCode: 409,
      retryable: false,
    });
  });
});
