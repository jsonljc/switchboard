import { describe, it, expect } from "vitest";
import { MESSAGING_MANIFEST, MESSAGING_ACTIONS } from "../manifest.js";

describe("Messaging Manifest", () => {
  it("has required manifest fields", () => {
    expect(MESSAGING_MANIFEST.id).toBe("messaging");
    expect(MESSAGING_MANIFEST.name).toBe("Messaging");
    expect(MESSAGING_MANIFEST.version).toBeDefined();
    expect(MESSAGING_MANIFEST.actions.length).toBeGreaterThan(0);
  });

  it("defines 3 actions", () => {
    expect(MESSAGING_ACTIONS).toHaveLength(3);
    const types = MESSAGING_ACTIONS.map((a) => a.actionType);
    expect(types).toContain("messaging.whatsapp.send");
    expect(types).toContain("messaging.whatsapp.send_template");
    expect(types).toContain("messaging.escalation.notify_owner");
  });

  it("all actions have required fields", () => {
    for (const action of MESSAGING_ACTIONS) {
      expect(action.actionType).toBeTruthy();
      expect(action.name).toBeTruthy();
      expect(action.description).toBeTruthy();
      expect(action.parametersSchema).toBeDefined();
      expect(action.baseRiskCategory).toBeDefined();
      expect(typeof action.reversible).toBe("boolean");
    }
  });
});
