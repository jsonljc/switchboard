import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseStructuredOutput } from "../structured-output.js";

const QualificationSchema = z.object({
  qualified: z.boolean(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

describe("parseStructuredOutput", () => {
  it("parses valid JSON matching schema", () => {
    const raw = '{"qualified": true, "reason": "budget match", "confidence": 0.9}';
    const result = parseStructuredOutput(raw, QualificationSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.qualified).toBe(true);
    }
  });

  it("extracts JSON from markdown code block", () => {
    const raw = '```json\n{"qualified": false, "reason": "no budget", "confidence": 0.3}\n```';
    const result = parseStructuredOutput(raw, QualificationSchema);
    expect(result.success).toBe(true);
  });

  it("returns failure for invalid JSON", () => {
    const raw = "not json at all";
    const result = parseStructuredOutput(raw, QualificationSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  it("returns failure for JSON that doesn't match schema", () => {
    const raw = '{"qualified": "maybe"}';
    const result = parseStructuredOutput(raw, QualificationSchema);
    expect(result.success).toBe(false);
  });
});
