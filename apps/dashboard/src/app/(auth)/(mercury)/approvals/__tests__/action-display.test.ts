import { describe, it, expect } from "vitest";
import { actionDisplay } from "../action-display";

describe("actionDisplay", () => {
  it("maps billing.refund.issue to 'refund'", () => {
    expect(actionDisplay("billing.refund.issue")).toBe("refund");
  });
  it("maps comms.sms.broadcast to 'SMS broadcast'", () => {
    expect(actionDisplay("comms.sms.broadcast")).toBe("SMS broadcast");
  });
  it("falls back to a tidied dotted id when unmapped", () => {
    expect(actionDisplay("custom.thing.x")).toBe("custom thing x");
  });
  it("falls back to 'action' for empty/undefined input", () => {
    expect(actionDisplay(undefined)).toBe("action");
    expect(actionDisplay("")).toBe("action");
  });
});
