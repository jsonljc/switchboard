import { describe, it, expect } from "vitest";
import { canRequalify, agentForStage } from "../lifecycle.js";

describe("canRequalify", () => {
  it("allows requalification for lead stage", () => {
    expect(canRequalify("lead")).toBe(true);
  });

  it("allows requalification for qualified stage", () => {
    expect(canRequalify("qualified")).toBe(true);
  });

  it("allows requalification for churned stage", () => {
    expect(canRequalify("churned")).toBe(true);
  });

  it("blocks requalification for treated stage", () => {
    expect(canRequalify("treated")).toBe(false);
  });

  it("blocks requalification for booked stage", () => {
    expect(canRequalify("booked")).toBe(false);
  });

  it("allows requalification when stage is undefined", () => {
    expect(canRequalify(undefined)).toBe(true);
  });
});

describe("agentForStage", () => {
  it("maps lead to lead-responder", () => {
    expect(agentForStage("lead")).toBe("lead-responder");
  });

  it("maps qualified to sales-closer", () => {
    expect(agentForStage("qualified")).toBe("sales-closer");
  });

  it("maps booked to null (escalate)", () => {
    expect(agentForStage("booked")).toBeNull();
  });

  it("maps treated to null (escalate)", () => {
    expect(agentForStage("treated")).toBeNull();
  });

  it("maps churned to null (escalate)", () => {
    expect(agentForStage("churned")).toBeNull();
  });

  it("defaults undefined to lead-responder", () => {
    expect(agentForStage(undefined)).toBe("lead-responder");
  });
});
