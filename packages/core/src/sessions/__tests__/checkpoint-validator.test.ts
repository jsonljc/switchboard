import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateCheckpoint } from "../checkpoint-validator.js";
import { AgentCheckpointSchema } from "@switchboard/schemas";

describe("validateCheckpoint", () => {
  it("accepts valid checkpoint with all fields", () => {
    const result = validateCheckpoint({
      agentState: { step: 3, memory: "something" },
      lastToolResult: { success: true },
      pendingApprovalId: "abc-123",
      extensions: { campaignId: "camp-1" },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts valid checkpoint with only required fields", () => {
    const result = validateCheckpoint({
      agentState: {},
    });
    expect(result.valid).toBe(true);
  });

  it("rejects checkpoint missing agentState", () => {
    const result = validateCheckpoint({} as Record<string, unknown>);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects null checkpoint", () => {
    const result = validateCheckpoint(null as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });

  it("validates against optional role-specific schema", () => {
    const roleSchema = AgentCheckpointSchema.extend({
      extensions: z
        .object({
          campaignId: z.string().min(1),
        })
        .optional(),
    });

    // Valid with role schema
    const validResult = validateCheckpoint(
      { agentState: { step: 1 }, extensions: { campaignId: "camp-1" } },
      roleSchema,
    );
    expect(validResult.valid).toBe(true);

    // Invalid: campaignId is empty string (min 1)
    const invalidResult = validateCheckpoint(
      { agentState: { step: 1 }, extensions: { campaignId: "" } },
      roleSchema,
    );
    expect(invalidResult.valid).toBe(false);
  });

  it("enforces max checkpoint size (500KB)", () => {
    const result = validateCheckpoint({
      agentState: { data: "x".repeat(600_000) },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("size");
    }
  });
});
