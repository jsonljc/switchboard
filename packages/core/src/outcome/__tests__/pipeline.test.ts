import { describe, it, expect, vi } from "vitest";
import { OutcomePipeline } from "../pipeline.js";
import type { OutcomeStore } from "../types.js";

function createMockStore(): OutcomeStore {
  return {
    saveEvent: vi.fn().mockResolvedValue(undefined),
    saveVariantLog: vi.fn().mockResolvedValue(undefined),
    listEvents: vi.fn().mockResolvedValue([]),
    listVariantLogs: vi.fn().mockResolvedValue([]),
    updateVariantReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe("OutcomePipeline", () => {
  it("should emit an outcome event", async () => {
    const store = createMockStore();
    const pipeline = new OutcomePipeline(store);

    const event = await pipeline.emitOutcome({
      sessionId: "session_1",
      organizationId: "org_1",
      outcomeType: "booked",
    });

    expect(event.id).toMatch(/^outcome_/);
    expect(event.outcomeType).toBe("booked");
    expect(store.saveEvent).toHaveBeenCalledOnce();
  });

  it("should log a response variant", async () => {
    const store = createMockStore();
    const pipeline = new OutcomePipeline(store);

    const log = await pipeline.logResponseVariant({
      sessionId: "session_1",
      organizationId: "org_1",
      primaryMove: "greet",
      responseText: "Hello! Welcome!",
    });

    expect(log.id).toMatch(/^variant_/);
    expect(log.primaryMove).toBe("greet");
    expect(store.saveVariantLog).toHaveBeenCalledOnce();
  });

  it("should record lead reply", async () => {
    const store = createMockStore();
    const pipeline = new OutcomePipeline(store);

    await pipeline.recordLeadReply("variant_1", true, true);

    expect(store.updateVariantReply).toHaveBeenCalledWith("variant_1", true, true);
  });
});
