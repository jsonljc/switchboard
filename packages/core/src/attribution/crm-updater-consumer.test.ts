import { describe, it, expect, vi, beforeEach } from "vitest";
import { CrmUpdaterConsumer } from "./crm-updater-consumer.js";
import type { ConversionEvent } from "../events/conversion-bus.js";

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "evt_1",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 0,
    occurredAt: new Date(),
    source: "calendar-book",
    metadata: { opportunityId: "opp_1" },
    ...overrides,
  };
}

describe("CrmUpdaterConsumer", () => {
  let opportunityStore: { updateStage: ReturnType<typeof vi.fn> };
  let activityStore: { write: ReturnType<typeof vi.fn> };
  let consumer: CrmUpdaterConsumer;

  beforeEach(() => {
    opportunityStore = { updateStage: vi.fn().mockResolvedValue({}) };
    activityStore = { write: vi.fn().mockResolvedValue(undefined) };
    consumer = new CrmUpdaterConsumer(opportunityStore as never, activityStore as never);
  });

  it("updates opportunity stage on booked event", async () => {
    await consumer.handle(makeEvent());
    expect(opportunityStore.updateStage).toHaveBeenCalledWith(
      "org_1",
      "opp_1",
      "booked",
      undefined,
    );
  });

  it("skips events without opportunityId", async () => {
    await consumer.handle(makeEvent({ metadata: {} }));
    expect(opportunityStore.updateStage).not.toHaveBeenCalled();
  });

  it("logs activity after stage update", async () => {
    await consumer.handle(makeEvent());
    expect(activityStore.write).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        eventType: "stage-update",
      }),
    );
  });

  it("maps event type to opportunity stage", async () => {
    await consumer.handle(makeEvent({ type: "qualified" }));
    expect(opportunityStore.updateStage).toHaveBeenCalledWith(
      "org_1",
      "opp_1",
      "qualified",
      undefined,
    );
  });

  it("handles purchased events with closed date", async () => {
    await consumer.handle(makeEvent({ type: "purchased" }));
    expect(opportunityStore.updateStage).toHaveBeenCalledWith(
      "org_1",
      "opp_1",
      "purchased",
      undefined,
    );
  });
});
