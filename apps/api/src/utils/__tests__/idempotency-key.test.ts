import { describe, it, expect } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getIdempotencyKey, requireIdempotencyKey } from "../idempotency-key.js";

function mkRequest(headers: Record<string, unknown>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply & { sent: { code?: number; body?: unknown } } {
  const captured: { code?: number; body?: unknown } = {};
  const reply = {
    sent: captured,
    code(c: number) {
      captured.code = c;
      return reply;
    },
    send(b: unknown) {
      captured.body = b;
      return reply;
    },
  };
  return reply as unknown as FastifyReply & { sent: { code?: number; body?: unknown } };
}

describe("getIdempotencyKey", () => {
  it("returns the trimmed header value when present", () => {
    expect(getIdempotencyKey(mkRequest({ "idempotency-key": "  abc-123  " }))).toBe("abc-123");
  });

  it("returns undefined when the header is missing", () => {
    expect(getIdempotencyKey(mkRequest({}))).toBeUndefined();
  });

  it("returns undefined when the header is an empty string", () => {
    expect(getIdempotencyKey(mkRequest({ "idempotency-key": "" }))).toBeUndefined();
  });

  it("returns undefined when the header is only whitespace", () => {
    expect(getIdempotencyKey(mkRequest({ "idempotency-key": "   " }))).toBeUndefined();
  });

  it("returns undefined when the header is a non-string (e.g. array)", () => {
    expect(getIdempotencyKey(mkRequest({ "idempotency-key": ["a", "b"] }))).toBeUndefined();
  });
});

describe("requireIdempotencyKey", () => {
  it("returns the trimmed header when present", () => {
    const reply = fakeReply();
    const key = requireIdempotencyKey(mkRequest({ "idempotency-key": "  abc123  " }), reply);
    expect(key).toBe("abc123");
    expect(reply.sent.code).toBeUndefined();
  });

  it("returns null and emits 400 when header absent", () => {
    const reply = fakeReply();
    const key = requireIdempotencyKey(mkRequest({}), reply);
    expect(key).toBeNull();
    expect(reply.sent.code).toBe(400);
    expect(reply.sent.body).toEqual({
      error: "missing_idempotency_key",
      hint: "Idempotency-Key header is required for this endpoint",
      statusCode: 400,
    });
  });

  it("returns null and emits 400 when header is whitespace-only", () => {
    const reply = fakeReply();
    const key = requireIdempotencyKey(mkRequest({ "idempotency-key": "   " }), reply);
    expect(key).toBeNull();
    expect(reply.sent.code).toBe(400);
  });

  it("returns null and emits 400 when header is non-string", () => {
    const reply = fakeReply();
    const key = requireIdempotencyKey(mkRequest({ "idempotency-key": ["a", "b"] }), reply);
    expect(key).toBeNull();
    expect(reply.sent.code).toBe(400);
  });
});
