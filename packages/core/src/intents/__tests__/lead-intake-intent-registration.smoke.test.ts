import { describe, it, expect, beforeEach } from "vitest";
import { IntentRegistry } from "../../platform/intent-registry.js";

// CTWA path regression pin (Phase 0 preflight, spec part d). The ad-optimizer
// CTWA adapter emits `intent: "lead.intake"` (ctwa-adapter.ts:103), threaded
// through buildCtwaIngressSubmitRequest (ctwa-ingress-request.ts:25) to
// PlatformIngress (apps/chat/src/main.ts:181). lead.intake is registered as a
// workflow at contained-workflows.ts:401 with allowedTriggers ["internal","api"].
// This pins the contract WITHOUT importing app code (core must not import apps):
// it registers the identical shape and proves the emitted intent + adapter
// trigger resolve, so a rename on either side reds here instead of returning
// intent_not_found at ingress in production.
const CTWA_EMITTED_INTENT = "lead.intake";

describe("CTWA lead.intake intent registration contract", () => {
  let registry: IntentRegistry;

  beforeEach(() => {
    registry = new IntentRegistry();
    // Mirror of the bootstrap registration (contained-workflows.ts:444-459).
    // The bootstrap loop fills in defaultMode/allowedModes/executor/parameterSchema/
    // mutationClass/idempotent/timeoutMs/retryable as shared defaults for all
    // contained workflow intents. lead.intake has no approvalMode override.
    registry.register({
      intent: "lead.intake",
      defaultMode: "workflow",
      allowedModes: ["workflow"],
      executor: { mode: "workflow", workflowId: "lead.intake" },
      parameterSchema: {},
      mutationClass: "write",
      budgetClass: "standard",
      approvalPolicy: "none",
      idempotent: false,
      allowedTriggers: ["internal", "api"],
      timeoutMs: 300_000,
      retryable: true,
    });
  });

  it("resolves the exact intent the CTWA adapter emits", () => {
    expect(registry.lookup(CTWA_EMITTED_INTENT)).toBeDefined();
  });

  it("accepts the adapter-originated triggers (internal/api), not chat", () => {
    expect(registry.validateTrigger(CTWA_EMITTED_INTENT, "internal")).toBe(true);
    expect(registry.validateTrigger(CTWA_EMITTED_INTENT, "api")).toBe(true);
    expect(registry.validateTrigger(CTWA_EMITTED_INTENT, "chat")).toBe(false);
  });
});
