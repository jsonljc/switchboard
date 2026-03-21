import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryDispatcher } from "../dispatcher.js";
import type { Intervention } from "@switchboard/schemas";

function makeIntervention(overrides: Partial<Intervention> = {}): Intervention {
  return {
    id: crypto.randomUUID(),
    cycleId: "cycle-1",
    constraintType: "SIGNAL",
    actionType: "FIX_TRACKING",
    status: "APPROVED",
    priority: 1,
    estimatedImpact: "HIGH",
    reasoning: "score 20/60",
    artifacts: [],
    outcomeStatus: "PENDING",
    measurementWindowDays: 7,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("InMemoryDispatcher", () => {
  let dispatcher: InMemoryDispatcher;

  beforeEach(() => {
    dispatcher = new InMemoryDispatcher();
  });

  it("auto-dispatches when governance level is AUTO", async () => {
    const intervention = makeIntervention();
    const result = await dispatcher.dispatch(intervention, "AUTO");

    expect(result.dispatched).toBe(true);
    expect(result.governanceLevel).toBe("AUTO");
    expect(result.externalRef).toBeDefined();
    expect(result.reason).toContain("auto-dispatched");
  });

  it("blocks dispatch when governance level is APPROVAL_REQUIRED", async () => {
    const intervention = makeIntervention();
    const result = await dispatcher.dispatch(intervention, "APPROVAL_REQUIRED");

    expect(result.dispatched).toBe(false);
    expect(result.governanceLevel).toBe("APPROVAL_REQUIRED");
    expect(result.reason).toContain("requires approval");
  });

  it("blocks dispatch when governance level is BLOCKED", async () => {
    const intervention = makeIntervention();
    const result = await dispatcher.dispatch(intervention, "BLOCKED");

    expect(result.dispatched).toBe(false);
    expect(result.governanceLevel).toBe("BLOCKED");
    expect(result.reason).toContain("blocked by governance");
  });

  it("records all dispatch attempts", async () => {
    const i1 = makeIntervention({ id: "int-1" });
    const i2 = makeIntervention({ id: "int-2" });

    await dispatcher.dispatch(i1, "AUTO");
    await dispatcher.dispatch(i2, "BLOCKED");

    const dispatched = dispatcher.getDispatched();
    expect(dispatched).toHaveLength(2);
    expect(dispatched[0]!.intervention.id).toBe("int-1");
    expect(dispatched[1]!.intervention.id).toBe("int-2");
  });

  it("clears dispatch history", async () => {
    const intervention = makeIntervention();
    await dispatcher.dispatch(intervention, "AUTO");

    dispatcher.clear();
    expect(dispatcher.getDispatched()).toHaveLength(0);
  });

  it("includes intervention id in reason message", async () => {
    const intervention = makeIntervention({ id: "my-intervention-id" });
    const result = await dispatcher.dispatch(intervention, "AUTO");
    expect(result.reason).toContain("my-intervention-id");
  });

  it("includes action type in reason for AUTO dispatch", async () => {
    const intervention = makeIntervention({ actionType: "REFRESH_CREATIVE" });
    const result = await dispatcher.dispatch(intervention, "AUTO");
    expect(result.reason).toContain("REFRESH_CREATIVE");
  });
});
