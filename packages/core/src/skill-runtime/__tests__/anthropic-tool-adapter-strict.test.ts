import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicToolAdapter, strictenToolSchema } from "../adapters/anthropic-tool-adapter.js";

// The integration tests below drive chatWithTools, which records prompt-cache
// effectiveness and warns on a zero-read "miss". The fixtures here populate the
// cache (no miss), but stub console.warn for safety + clean output.
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("strictenToolSchema — strict-eligibility detection", () => {
  it("marks a flat all-required scalar+enum schema strict and adds additionalProperties:false", () => {
    const schema = {
      type: "object",
      properties: {
        service: { type: "string" },
        slotStart: { type: "string" },
        reason: { type: "string", enum: ["a", "b"] },
        count: { type: "number" },
      },
      required: ["service", "slotStart", "reason", "count"],
    };
    const result = strictenToolSchema(schema);
    expect(result.strict).toBe(true);
    expect(result.inputSchema.additionalProperties).toBe(false);
    // properties preserved verbatim
    expect((result.inputSchema.properties as Record<string, unknown>).reason).toEqual({
      type: "string",
      enum: ["a", "b"],
    });
    // input is not mutated (additionalProperties added on a copy)
    expect("additionalProperties" in schema).toBe(false);
  });

  it("marks an empty-properties object schema strict (model must call with {})", () => {
    const schema = { type: "object", properties: {}, required: [] };
    const result = strictenToolSchema(schema);
    expect(result.strict).toBe(true);
    expect(result.inputSchema.additionalProperties).toBe(false);
  });

  it("leaves a schema with an OPTIONAL property loose and unchanged (strict requires all-required)", () => {
    const schema = {
      type: "object",
      properties: { reason: { type: "string" }, note: { type: "string" } },
      required: ["reason"],
    };
    const result = strictenToolSchema(schema);
    expect(result.strict).toBe(false);
    expect(result.inputSchema).toBe(schema); // same reference, untouched
  });

  it("leaves a schema with minimum/maximum loose (strict 400s on numeric range keywords)", () => {
    expect(
      strictenToolSchema({
        type: "object",
        properties: { confidence: { type: "number", minimum: 0, maximum: 1 } },
        required: ["confidence"],
      }).strict,
    ).toBe(false);
  });

  it("leaves a schema with a string length/pattern/format keyword loose", () => {
    expect(
      strictenToolSchema({
        type: "object",
        properties: { code: { type: "string", minLength: 3 } },
        required: ["code"],
      }).strict,
    ).toBe(false);
    expect(
      strictenToolSchema({
        type: "object",
        properties: { email: { type: "string", format: "email" } },
        required: ["email"],
      }).strict,
    ).toBe(false);
  });

  it("leaves a schema with a NESTED object property loose (conservative)", () => {
    expect(
      strictenToolSchema({
        type: "object",
        properties: { addr: { type: "object", properties: { city: { type: "string" } } } },
        required: ["addr"],
      }).strict,
    ).toBe(false);
  });

  it("leaves a schema with an ARRAY property loose (conservative)", () => {
    expect(
      strictenToolSchema({
        type: "object",
        properties: { paths: { type: "array", items: { type: "string" } } },
        required: ["paths"],
      }).strict,
    ).toBe(false);
  });

  it("leaves a non-object schema loose", () => {
    expect(strictenToolSchema({ type: "string" }).strict).toBe(false);
  });
});

describe("AnthropicToolAdapter — strict tool schemas", () => {
  const okResp = () => ({
    content: [{ type: "text", text: "ok" }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 50,
    },
  });

  it("sets strict:true + additionalProperties:false on an eligible (all-required scalar) tool", async () => {
    const create = vi.fn().mockResolvedValue(okResp());
    const adapter = new AnthropicToolAdapter({ messages: { create } } as never);
    await adapter.chatWithTools({
      system: "s",
      messages: [{ role: "user", content: "x" }],
      tools: [
        {
          name: "calendar.book",
          description: "book",
          input_schema: {
            type: "object",
            properties: { service: { type: "string" }, slot: { type: "string" } },
            required: ["service", "slot"],
          },
        },
      ],
    });
    const body = create.mock.calls[0]![0] as {
      tools: Array<{ strict?: boolean; input_schema: { additionalProperties?: unknown } }>;
    };
    expect(body.tools[0]!.strict).toBe(true);
    expect(body.tools[0]!.input_schema.additionalProperties).toBe(false);
  });

  it("does NOT set strict on a tool with an optional property", async () => {
    const create = vi.fn().mockResolvedValue(okResp());
    const adapter = new AnthropicToolAdapter({ messages: { create } } as never);
    await adapter.chatWithTools({
      system: "s",
      messages: [{ role: "user", content: "x" }],
      tools: [
        {
          name: "escalate",
          description: "esc",
          input_schema: {
            type: "object",
            properties: { reason: { type: "string" }, note: { type: "string" } },
            required: ["reason"],
          },
        },
      ],
    });
    const body = create.mock.calls[0]![0] as {
      tools: Array<{ strict?: boolean; input_schema: { additionalProperties?: unknown } }>;
    };
    expect("strict" in body.tools[0]!).toBe(false);
    expect("additionalProperties" in body.tools[0]!.input_schema).toBe(false);
  });
});
