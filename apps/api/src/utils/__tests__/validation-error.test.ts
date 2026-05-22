import { describe, expect, it } from "vitest";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { replyValidationError } from "../validation-error.js";

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

describe("replyValidationError", () => {
  it("emits 400 with normalized envelope per spec §4.3", () => {
    const schema = z.object({ name: z.string().min(1) });
    const result = schema.safeParse({ name: "" });
    if (result.success) throw new Error("test setup invariant: parse should fail");

    const reply = fakeReply();
    replyValidationError(reply, result.error);

    expect(reply.sent.code).toBe(400);
    expect(reply.sent.body).toEqual({
      error: "invalid_body",
      issues: result.error.issues,
      statusCode: 400,
    });
  });

  it("returns the reply for chainable use", () => {
    const schema = z.object({ x: z.number() });
    const result = schema.safeParse({ x: "not a number" });
    if (result.success) throw new Error("test setup invariant: parse should fail");

    const reply = fakeReply();
    const returned = replyValidationError(reply, result.error);
    expect(returned).toBe(reply);
  });
});
