import { describe, it, expect } from "vitest";
import {
  isValidTaxonomyCode,
  getCategoryForCode,
  structuredError,
  TAXONOMY_CODES,
  DEFAULT_REMEDIATIONS,
  ERROR_CATEGORIES,
} from "../error-taxonomy.js";
import { denied, pendingApproval } from "../tool-result.js";

describe("Error Taxonomy", () => {
  describe("isValidTaxonomyCode", () => {
    it("returns true for known codes", () => {
      expect(isValidTaxonomyCode("DENIED_BY_POLICY")).toBe(true);
      expect(isValidTaxonomyCode("TOOL_NOT_FOUND")).toBe(true);
      expect(isValidTaxonomyCode("CIRCUIT_BREAKER_TRIPPED")).toBe(true);
    });

    it("returns false for unknown codes", () => {
      expect(isValidTaxonomyCode("MADE_UP_CODE")).toBe(false);
      expect(isValidTaxonomyCode("")).toBe(false);
    });
  });

  describe("getCategoryForCode", () => {
    it("resolves governance codes", () => {
      expect(getCategoryForCode("DENIED_BY_POLICY")).toBe("governance");
      expect(getCategoryForCode("TRUST_LEVEL_INSUFFICIENT")).toBe("governance");
    });

    it("resolves execution codes", () => {
      expect(getCategoryForCode("TOOL_NOT_FOUND")).toBe("execution");
      expect(getCategoryForCode("INVALID_INPUT")).toBe("execution");
    });

    it("resolves budget codes", () => {
      expect(getCategoryForCode("TOKEN_BUDGET_EXCEEDED")).toBe("budget");
      expect(getCategoryForCode("BLAST_RADIUS_EXCEEDED")).toBe("budget");
    });

    it("resolves approval codes", () => {
      expect(getCategoryForCode("APPROVAL_REQUIRED")).toBe("approval");
      expect(getCategoryForCode("BINDING_HASH_MISMATCH")).toBe("approval");
    });

    it("resolves circuit codes", () => {
      expect(getCategoryForCode("CIRCUIT_BREAKER_TRIPPED")).toBe("circuit");
      expect(getCategoryForCode("SAFETY_ENVELOPE_EXCEEDED")).toBe("circuit");
    });

    it("returns undefined for unknown codes", () => {
      expect(getCategoryForCode("UNKNOWN")).toBeUndefined();
    });
  });

  describe("DEFAULT_REMEDIATIONS coverage", () => {
    it("every taxonomy code has a default remediation entry", () => {
      for (const category of ERROR_CATEGORIES) {
        for (const code of TAXONOMY_CODES[category]) {
          const remediation = DEFAULT_REMEDIATIONS[code];
          expect(remediation).toBeDefined();
          expect(remediation!.modelRemediation).toBeTruthy();
          expect(remediation!.operatorRemediation).toBeTruthy();
          expect(typeof remediation!.retryable).toBe("boolean");
        }
      }
    });
  });

  describe("structuredError builder", () => {
    it("uses defaults when no overrides provided", () => {
      const err = structuredError("execution", "TOOL_NOT_FOUND", "Unknown tool: foo.bar");
      expect(err.category).toBe("execution");
      expect(err.code).toBe("TOOL_NOT_FOUND");
      expect(err.message).toBe("Unknown tool: foo.bar");
      expect(err.modelRemediation).toBe("Tool not found. Check available tools for this skill.");
      expect(err.operatorRemediation).toBe("Tool ID does not match any registered tool.");
      expect(err.retryable).toBe(false);
    });

    it("allows overrides", () => {
      const err = structuredError("governance", "DENIED_BY_POLICY", "Nope", {
        modelRemediation: "Custom model text",
        operatorRemediation: "Custom operator text",
        retryable: true,
        retryAfterMs: 5000,
      });
      expect(err.modelRemediation).toBe("Custom model text");
      expect(err.operatorRemediation).toBe("Custom operator text");
      expect(err.retryable).toBe(true);
      expect(err.retryAfterMs).toBe(5000);
    });

    it("provides fallback for unknown codes", () => {
      const err = structuredError("execution", "UNKNOWN_CODE", "Something broke");
      expect(err.modelRemediation).toBe("An error occurred. Try again.");
      expect(err.operatorRemediation).toBe("Unexpected error. Check logs.");
      expect(err.retryable).toBe(false);
    });
  });

  describe("ToolResult helper taxonomy validation", () => {
    it("denied() uses DENIED_BY_POLICY which is a valid taxonomy code", () => {
      const result = denied("Not allowed");
      expect(result.error?.code).toBe("DENIED_BY_POLICY");
      expect(isValidTaxonomyCode(result.error!.code)).toBe(true);
    });

    it("pendingApproval() uses APPROVAL_REQUIRED which is a valid taxonomy code", () => {
      const result = pendingApproval("Needs approval");
      expect(result.error?.code).toBe("APPROVAL_REQUIRED");
      expect(isValidTaxonomyCode(result.error!.code)).toBe(true);
    });
  });
});
