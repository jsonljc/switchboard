import { describe, it, expect } from "vitest";
import {
  GovernanceVerdictSchema,
  GovernanceVerdictReasonSchema,
  GovernanceVerdictSourceSchema,
} from "../governance-verdict.js";

describe("GovernanceVerdictSchema", () => {
  it("validates an allow verdict", () => {
    const verdict = {
      action: "allow",
      reasonCode: "allowed",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "banned_phrase_scanner",
      auditLevel: "info",
      decidedAt: "2026-05-10T08:30:00.000Z",
      conversationId: "conv_abc123",
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(true);
  });

  it("validates a rewrite verdict with original and emitted text", () => {
    const verdict = {
      action: "rewrite",
      reasonCode: "unsupported_claim",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "banned_phrase_scanner",
      originalText: "Most clients see visible slimming after one session.",
      emittedText: "Individual results vary; the doctor will advise during consultation.",
      auditLevel: "warning",
      decidedAt: "2026-05-10T08:30:00.000Z",
      conversationId: "conv_abc123",
      modelLatencyMs: 412,
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(true);
  });

  it("validates a block verdict outside whatsapp window", () => {
    const verdict = {
      action: "block",
      reasonCode: "outside_whatsapp_window",
      jurisdiction: "MY",
      clinicType: "nonMedical",
      sourceGuard: "whatsapp_window",
      auditLevel: "critical",
      decidedAt: "2026-05-10T08:30:00.000Z",
      conversationId: "conv_xyz789",
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(true);
  });

  it("rejects unknown action", () => {
    const verdict = {
      action: "ignore",
      reasonCode: "allowed",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "banned_phrase_scanner",
      auditLevel: "info",
      decidedAt: "2026-05-10T08:30:00.000Z",
      conversationId: "conv_abc123",
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(false);
  });

  it("rejects unknown reasonCode", () => {
    const verdict = {
      action: "block",
      reasonCode: "looks_weird",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "banned_phrase_scanner",
      auditLevel: "warning",
      decidedAt: "2026-05-10T08:30:00.000Z",
      conversationId: "conv_abc123",
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(false);
  });

  it("rejects malformed decidedAt", () => {
    const verdict = {
      action: "allow",
      reasonCode: "allowed",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "banned_phrase_scanner",
      auditLevel: "info",
      decidedAt: "yesterday",
      conversationId: "conv_abc123",
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(false);
  });
});

describe("GovernanceVerdictReasonSchema (1b-1 extensions)", () => {
  it("accepts sensitive_inbound", () => {
    expect(GovernanceVerdictReasonSchema.safeParse("sensitive_inbound").success).toBe(true);
  });

  it("accepts compliance_concern", () => {
    expect(GovernanceVerdictReasonSchema.safeParse("compliance_concern").success).toBe(true);
  });

  it("accepts governance_unavailable", () => {
    expect(GovernanceVerdictReasonSchema.safeParse("governance_unavailable").success).toBe(true);
  });

  it("still accepts pre-existing reasons", () => {
    for (const r of [
      "allowed",
      "banned_phrase",
      "unsupported_claim",
      "medical_safety_trigger",
      "outside_whatsapp_window",
      "consent_missing",
      "classifier_timeout",
    ]) {
      expect(GovernanceVerdictReasonSchema.safeParse(r).success).toBe(true);
    }
  });
});

describe("GovernanceVerdictSourceSchema (1b-1 changes)", () => {
  it("accepts banned_phrase_scanner", () => {
    expect(GovernanceVerdictSourceSchema.safeParse("banned_phrase_scanner").success).toBe(true);
  });

  it("accepts claim_classifier", () => {
    expect(GovernanceVerdictSourceSchema.safeParse("claim_classifier").success).toBe(true);
  });

  it("rejects claim_scanner", () => {
    expect(GovernanceVerdictSourceSchema.safeParse("claim_scanner").success).toBe(false);
  });

  it("still accepts other 1a sources", () => {
    for (const s of ["escalation_trigger", "consent_gate", "whatsapp_window"]) {
      expect(GovernanceVerdictSourceSchema.safeParse(s).success).toBe(true);
    }
  });
});
