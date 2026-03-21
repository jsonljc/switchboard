import { describe, it, expect } from "vitest";
import { validatePayload, PayloadValidationError } from "../validate-payload.js";

describe("validatePayload", () => {
  it("returns validated fields when all required fields are present", () => {
    const payload = { contactId: "c1", score: 85, active: true };
    const result = validatePayload(payload, {
      contactId: "string",
      score: "number",
      active: "boolean",
    });

    expect(result).toBe(payload);
    expect(result.contactId).toBe("c1");
    expect(result.score).toBe(85);
    expect(result.active).toBe(true);
  });

  it("throws PayloadValidationError when required string field is missing", () => {
    const payload = { score: 85 };

    expect(() => validatePayload(payload, { contactId: "string", score: "number" })).toThrow(
      PayloadValidationError,
    );

    try {
      validatePayload(payload, { contactId: "string", score: "number" });
    } catch (err) {
      const e = err as PayloadValidationError;
      expect(e.missingFields).toEqual(["contactId"]);
      expect(e.wrongTypeFields).toEqual([]);
      expect(e.message).toContain("missing required fields: contactId");
    }
  });

  it("throws PayloadValidationError when field has wrong type", () => {
    const payload = { contactId: 123, score: "not-a-number" };

    expect(() => validatePayload(payload, { contactId: "string", score: "number" })).toThrow(
      PayloadValidationError,
    );

    try {
      validatePayload(payload, { contactId: "string", score: "number" });
    } catch (err) {
      const e = err as PayloadValidationError;
      expect(e.missingFields).toEqual([]);
      expect(e.wrongTypeFields).toEqual(["contactId", "score"]);
      expect(e.message).toContain("wrong type fields: contactId, score");
    }
  });

  it("handles optional fields with ? suffix (missing optional is OK)", () => {
    const payload = { contactId: "c1" };
    const result = validatePayload(payload, {
      contactId: "string",
      notes: "string?",
    });

    expect(result).toBe(payload);
  });

  it("throws when an optional field is present but has the wrong type", () => {
    const payload = { contactId: "c1", notes: 42 };

    expect(() => validatePayload(payload, { contactId: "string", notes: "string?" })).toThrow(
      PayloadValidationError,
    );

    try {
      validatePayload(payload, { contactId: "string", notes: "string?" });
    } catch (err) {
      const e = err as PayloadValidationError;
      expect(e.missingFields).toEqual([]);
      expect(e.wrongTypeFields).toEqual(["notes"]);
    }
  });

  it("includes agent context in error message when agentId provided", () => {
    const payload = { score: 85 };

    try {
      validatePayload(payload, { contactId: "string", score: "number" }, "lead-responder");
    } catch (err) {
      const e = err as PayloadValidationError;
      expect(e.agentId).toBe("lead-responder");
      expect(e.message).toContain("[lead-responder]");
      expect(e.message).toContain("Invalid event payload");
    }
  });

  it("handles null payload gracefully (throws)", () => {
    expect(() => validatePayload(null, { contactId: "string" }, "test-agent")).toThrow(
      PayloadValidationError,
    );

    try {
      validatePayload(null, { contactId: "string" }, "test-agent");
    } catch (err) {
      const e = err as PayloadValidationError;
      expect(e.missingFields).toEqual(["contactId"]);
      expect(e.message).toContain("[test-agent]");
    }
  });

  it("handles undefined payload gracefully (throws)", () => {
    expect(() => validatePayload(undefined, { contactId: "string" })).toThrow(
      PayloadValidationError,
    );

    try {
      validatePayload(undefined, { contactId: "string" });
    } catch (err) {
      const e = err as PayloadValidationError;
      expect(e.missingFields).toEqual(["contactId"]);
    }
  });
});
