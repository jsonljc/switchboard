import { describe, it, expect } from "vitest";
import { agentDisplay } from "../agent-display";

describe("agentDisplay", () => {
  it("maps billing-agent to Alex / Billing & Bookings", () => {
    expect(agentDisplay("billing-agent")).toEqual({ name: "Alex", role: "Billing & Bookings" });
  });
  it("maps growth-agent to Riley / Growth", () => {
    expect(agentDisplay("growth-agent")).toEqual({ name: "Riley", role: "Growth" });
  });
  it("maps support-agent to Mira / Care", () => {
    expect(agentDisplay("support-agent")).toEqual({ name: "Mira", role: "Care" });
  });
  it("returns generic fallback for unknown ids", () => {
    expect(agentDisplay("unknown-agent")).toEqual({ name: "an agent", role: null });
  });
  it("returns generic fallback for empty / undefined input", () => {
    expect(agentDisplay(undefined)).toEqual({ name: "an agent", role: null });
    expect(agentDisplay("")).toEqual({ name: "an agent", role: null });
  });
});
