import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutcomeDispatcher } from "./outcome-dispatcher.js";

const makeContact = (sourceType: string, attribution: Record<string, unknown>) => ({
  id: "c1",
  organizationId: "o1",
  sourceType,
  attribution,
});

describe("OutcomeDispatcher", () => {
  let capi: { dispatch: ReturnType<typeof vi.fn> };
  let store: { getContact: ReturnType<typeof vi.fn> };
  let dispatcher: OutcomeDispatcher;

  beforeEach(() => {
    capi = { dispatch: vi.fn().mockResolvedValue({ ok: true }) };
    store = { getContact: vi.fn() };
    dispatcher = new OutcomeDispatcher({ capi, store });
  });

  it("CTWA booked → Schedule with action_source=business_messaging + ctwa_clid", async () => {
    store.getContact.mockResolvedValue(makeContact("ctwa", { ctwa_clid: "abc" }));
    await dispatcher.handle({ contactId: "c1", kind: "booked" });
    expect(capi.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Schedule",
        actionSource: "business_messaging",
        attribution: expect.objectContaining({ ctwa_clid: "abc" }),
      }),
    );
  });

  it("Instant Form qualified → Lead with action_source=system_generated", async () => {
    store.getContact.mockResolvedValue(makeContact("instant_form", { leadgen_id: "9" }));
    await dispatcher.handle({ contactId: "c1", kind: "qualified" });
    expect(capi.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Lead",
        actionSource: "system_generated",
      }),
    );
  });

  it("paid event includes value", async () => {
    store.getContact.mockResolvedValue(makeContact("ctwa", { ctwa_clid: "abc" }));
    await dispatcher.handle({ contactId: "c1", kind: "paid", value: 250.5, currency: "SGD" });
    expect(capi.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "Purchase", value: 250.5, currency: "SGD" }),
    );
  });

  it("organic source → no dispatch, warns", async () => {
    store.getContact.mockResolvedValue(makeContact("organic", {}));
    await dispatcher.handle({ contactId: "c1", kind: "booked" });
    expect(capi.dispatch).not.toHaveBeenCalled();
  });

  it("missing contact → no dispatch, warns", async () => {
    store.getContact.mockResolvedValue(null);
    await dispatcher.handle({ contactId: "missing", kind: "qualified" });
    expect(capi.dispatch).not.toHaveBeenCalled();
  });

  it("contact with null sourceType → no dispatch, warns", async () => {
    store.getContact.mockResolvedValue({
      id: "c1",
      organizationId: "o1",
      sourceType: null,
      attribution: {},
    });
    await dispatcher.handle({ contactId: "c1", kind: "qualified" });
    expect(capi.dispatch).not.toHaveBeenCalled();
  });
});
