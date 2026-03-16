import { describe, it, expect, vi } from "vitest";
import { emitDealStageEvent } from "../deal-stage-events.js";

describe("emitDealStageEvent", () => {
  it("emits 'purchased' when deal moves to 'appointment_attended'", () => {
    const bus = { emit: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };
    const deal = {
      contactId: "contact-1",
      organizationId: "org-1",
      amount: 350,
      stage: "appointment_attended",
    };
    const contact = { sourceCampaignId: "camp-1", sourceAdId: "ad-1" };

    emitDealStageEvent(bus, deal, contact);

    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "purchased",
        contactId: "contact-1",
        value: 350,
        sourceCampaignId: "camp-1",
        sourceAdId: "ad-1",
      }),
    );
  });

  it("emits 'completed' when deal moves to 'closed_won'", () => {
    const bus = { emit: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };
    const deal = {
      contactId: "contact-1",
      organizationId: "org-1",
      amount: 500,
      stage: "closed_won",
    };

    emitDealStageEvent(bus, deal, null);

    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "completed",
        contactId: "contact-1",
        value: 500,
      }),
    );
  });

  it("emits 'completed' when deal moves to 'treatment_paid'", () => {
    const bus = { emit: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };
    const deal = {
      contactId: "contact-1",
      organizationId: "org-1",
      amount: 200,
      stage: "treatment_paid",
    };

    emitDealStageEvent(bus, deal, null);

    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "completed",
        value: 200,
      }),
    );
  });

  it("does not emit for non-revenue stages", () => {
    const bus = { emit: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };
    const deal = {
      contactId: "contact-1",
      organizationId: "org-1",
      amount: 0,
      stage: "qualified",
    };

    emitDealStageEvent(bus, deal, null);

    expect(bus.emit).not.toHaveBeenCalled();
  });

  it("uses 0 as value when amount is null", () => {
    const bus = { emit: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };
    const deal = {
      contactId: "contact-1",
      organizationId: "org-1",
      amount: null,
      stage: "appointment_attended",
    };

    emitDealStageEvent(bus, deal, null);

    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ value: 0 }));
  });
});
