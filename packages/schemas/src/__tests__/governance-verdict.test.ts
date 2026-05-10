import { describe, it, expect } from "vitest";
import { GovernanceVerdictSchema } from "../governance-verdict.js";

describe("GovernanceVerdictSchema", () => {
  it("validates an allow verdict", () => {
    const verdict = {
      action: "allow",
      reasonCode: "allowed",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "claim_scanner",
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
      sourceGuard: "claim_scanner",
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
      sourceGuard: "claim_scanner",
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
      sourceGuard: "claim_scanner",
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
      sourceGuard: "claim_scanner",
      auditLevel: "info",
      decidedAt: "yesterday",
      conversationId: "conv_abc123",
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(false);
  });
});
