import { describe, expect, it } from "vitest";
import { canTransitionLifecycle as canTransition } from "../precedence.js";

describe("canTransitionLifecycle", () => {
  it("allows escalated → booked (operator closes booking after takeover)", () => {
    expect(canTransition("escalated", "booked")).toBe(true);
  });

  it("blocks booked → stalled (booked is terminal)", () => {
    expect(canTransition("booked", "stalled")).toBe(false);
  });

  it("blocks disqualified → stalled (disqualified terminal until operator reverts)", () => {
    expect(canTransition("disqualified", "stalled")).toBe(false);
  });

  it("allows stalled → active (re-open path)", () => {
    expect(canTransition("stalled", "active")).toBe(true);
  });

  it("allows null → active (normal thread initialization)", () => {
    expect(canTransition(null, "active")).toBe(true);
  });

  it("allows null → booked (booking event arrives before any other lifecycle observation)", () => {
    expect(canTransition(null, "booked")).toBe(true);
  });

  it("allows null → escalated (governance fires before any lifecycle observation)", () => {
    expect(canTransition(null, "escalated")).toBe(true);
  });

  it("blocks null → stalled — cron must not create a snapshot from nothing; thread-init must run first", () => {
    expect(canTransition(null, "stalled")).toBe(false);
  });

  it("blocks null → qualified — qualification (3b) must follow an active observation", () => {
    expect(canTransition(null, "qualified")).toBe(false);
  });

  it("blocks null → disqualified — disqualification (3b) must follow an active observation", () => {
    expect(canTransition(null, "disqualified")).toBe(false);
  });

  it("allows any non-terminal → escalated (escalation can fire from anywhere)", () => {
    expect(canTransition("active", "escalated")).toBe(true);
    expect(canTransition("qualified", "escalated")).toBe(true);
    expect(canTransition("stalled", "escalated")).toBe(true);
  });

  it("allows any non-terminal → booked (booking can fire from anywhere including escalated)", () => {
    expect(canTransition("active", "booked")).toBe(true);
    expect(canTransition("qualified", "booked")).toBe(true);
    expect(canTransition("stalled", "booked")).toBe(true);
    expect(canTransition("escalated", "booked")).toBe(true);
  });
});
