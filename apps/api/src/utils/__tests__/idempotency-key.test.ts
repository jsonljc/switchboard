import { describe, it, expect } from "vitest";
import type { FastifyRequest } from "fastify";
import { getIdempotencyKey } from "../idempotency-key.js";

function mkRequest(headers: Record<string, unknown>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
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
