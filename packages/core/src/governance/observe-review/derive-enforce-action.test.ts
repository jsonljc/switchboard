import { describe, it, expect } from "vitest";
import { deriveEnforceAction } from "./derive-enforce-action.js";

describe("deriveEnforceAction", () => {
  it("observe telemetry (action=allow): banned phrase / price -> block", () => {
    expect(deriveEnforceAction("banned_phrase_scanner", "banned_phrase", "allow")).toBe("block");
    expect(deriveEnforceAction("price_gate", "unsubstantiated_price", "allow")).toBe("block");
  });
  it("observe telemetry (action=allow): claim classifier rewrite vs escalate", () => {
    expect(deriveEnforceAction("claim_classifier", "unsupported_claim_rewritten", "allow")).toBe(
      "rewrite",
    );
    expect(deriveEnforceAction("claim_classifier", "unsupported_claim_escalated", "allow")).toBe(
      "escalate",
    );
    expect(deriveEnforceAction("claim_classifier", "unsupported_claim", "allow")).toBe("escalate");
    expect(deriveEnforceAction("claim_classifier", "claim_substantiation_stale", "allow")).toBe(
      "escalate",
    );
  });
  it("observe telemetry (action=allow): claim timeout/error -> none", () => {
    expect(deriveEnforceAction("claim_classifier", "classifier_timeout", "allow")).toBe("none");
    expect(deriveEnforceAction("claim_classifier", "classifier_error", "allow")).toBe("none");
  });
  it("observe telemetry (action=allow): consent revoked -> block; disclosure/jurisdiction -> none", () => {
    expect(deriveEnforceAction("consent_gate", "consent_revoked", "allow")).toBe("block");
    expect(deriveEnforceAction("consent_gate", "disclosure_not_shown", "allow")).toBe("none");
    expect(deriveEnforceAction("consent_gate", "disclosure_version_outdated", "allow")).toBe(
      "none",
    );
    expect(deriveEnforceAction("consent_gate", "jurisdiction_mismatch", "allow")).toBe("none");
    // consent records governance_unavailable with action "allow" (it never blocks on resolver error).
    expect(deriveEnforceAction("consent_gate", "governance_unavailable", "allow")).toBe("none");
  });
  it("whatsapp window stores its real action even in observe: block vs template_required", () => {
    // Both carry reasonCode "outside_whatsapp_window"; the action distinguishes them.
    expect(deriveEnforceAction("whatsapp_window", "outside_whatsapp_window", "block")).toBe(
      "block",
    );
    expect(
      deriveEnforceAction("whatsapp_window", "outside_whatsapp_window", "template_required"),
    ).toBe("template");
    // Inside-window happy path records action "allow" / reason "allowed" -> no action.
    expect(deriveEnforceAction("whatsapp_window", "allowed", "allow")).toBe("none");
  });
  it("a real enforce action on the verdict maps directly regardless of sourceGuard", () => {
    // e.g. a verdict recorded while a gate was briefly in enforce, or fail-closed block.
    expect(deriveEnforceAction("price_gate", "governance_unavailable", "block")).toBe("block");
    expect(deriveEnforceAction("claim_classifier", "unsupported_claim_escalated", "escalate")).toBe(
      "escalate",
    );
  });
});
