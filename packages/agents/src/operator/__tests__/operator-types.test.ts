import { describe, it, expect } from "vitest";
import { INTENT_AGENT_MAP, READ_ONLY_INTENTS } from "../operator-types.js";
import { LAUNCH_INTENTS } from "@switchboard/schemas";

describe("operator-types constants", () => {
  it("INTENT_AGENT_MAP maps all launch intents to known agents", () => {
    const knownAgents = [
      "lead-responder",
      "sales-closer",
      "nurture",
      "ad-optimizer",
      "revenue-tracker",
      "operator",
    ];
    for (const agent of Object.values(INTENT_AGENT_MAP)) {
      expect(knownAgents).toContain(agent);
    }
  });

  it("READ_ONLY_INTENTS are a subset of LAUNCH_INTENTS", () => {
    for (const intent of READ_ONLY_INTENTS) {
      expect(LAUNCH_INTENTS).toContain(intent);
    }
  });

  it("READ_ONLY_INTENTS does not contain write intents", () => {
    expect(READ_ONLY_INTENTS.has("pause_campaigns")).toBe(false);
    expect(READ_ONLY_INTENTS.has("reassign_leads")).toBe(false);
  });

  it("INTENT_AGENT_MAP covers all LAUNCH_INTENTS", () => {
    for (const intent of LAUNCH_INTENTS) {
      expect(INTENT_AGENT_MAP).toHaveProperty(intent);
    }
  });
});
