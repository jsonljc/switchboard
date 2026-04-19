import { describe, it, expect, beforeEach } from "vitest";
import { IntentRegistry } from "../intent-registry.js";
import { registerPipelineIntents } from "../pipeline-intent-registrar.js";

describe("registerPipelineIntents", () => {
  let registry: IntentRegistry;

  beforeEach(() => {
    registry = new IntentRegistry();
  });

  it("registers creative.produce intent", () => {
    registerPipelineIntents(registry);

    const registration = registry.lookup("creative.produce");
    expect(registration).toBeDefined();
    expect(registration?.intent).toBe("creative.produce");
  });

  it("registers creative.ugc.produce intent", () => {
    registerPipelineIntents(registry);

    const registration = registry.lookup("creative.ugc.produce");
    expect(registration).toBeDefined();
    expect(registration?.intent).toBe("creative.ugc.produce");
  });

  it("sets executor binding to pipeline mode", () => {
    registerPipelineIntents(registry);

    const polishedReg = registry.lookup("creative.produce");
    expect(polishedReg?.executor).toEqual({ mode: "pipeline", pipelineId: "polished" });

    const ugcReg = registry.lookup("creative.ugc.produce");
    expect(ugcReg?.executor).toEqual({ mode: "pipeline", pipelineId: "ugc" });
  });

  it("sets budgetClass to expensive", () => {
    registerPipelineIntents(registry);

    const registration = registry.lookup("creative.produce");
    expect(registration?.budgetClass).toBe("expensive");
  });

  it("allows all triggers", () => {
    registerPipelineIntents(registry);

    const registration = registry.lookup("creative.produce");
    expect(registration?.allowedTriggers).toEqual(["api", "schedule", "internal", "chat"]);
  });
});
