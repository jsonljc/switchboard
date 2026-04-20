import { describe, it, expect } from "vitest";
import {
  getReadySectionCount,
  getRequiredSectionCount,
  getReadinessLabel,
  getNextMissingSection,
  getSectionDisplayName,
} from "../playbook-utils";
import { createEmptyPlaybook } from "@switchboard/schemas";

describe("playbook-utils", () => {
  it("counts ready sections from empty playbook", () => {
    const playbook = createEmptyPlaybook();
    expect(getReadySectionCount(playbook)).toBe(0);
    expect(getRequiredSectionCount()).toBe(5);
  });

  it("returns correct readiness label when all missing", () => {
    const playbook = createEmptyPlaybook();
    expect(getReadinessLabel(playbook)).toBe("0 of 5 required sections ready");
  });

  it("returns 'Ready to test Alex' when all required are ready", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "ready";
    playbook.services = [
      { id: "1", name: "Test", bookingBehavior: "ask_first", status: "ready", source: "manual" },
    ];
    playbook.hours.status = "ready";
    playbook.bookingRules.status = "ready";
    playbook.approvalMode.status = "ready";
    expect(getReadinessLabel(playbook)).toBe("Ready to test Alex");
  });

  it("names the remaining section when 1 left", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "ready";
    playbook.services = [
      { id: "1", name: "Test", bookingBehavior: "ask_first", status: "ready", source: "manual" },
    ];
    playbook.hours.status = "ready";
    playbook.bookingRules.status = "ready";
    const label = getReadinessLabel(playbook);
    expect(label).toBe("Almost ready: set your Approval Mode");
  });

  it("finds next missing section", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "ready";
    expect(getNextMissingSection(playbook)).toBe("services");
  });

  it("returns display names", () => {
    expect(getSectionDisplayName("businessIdentity")).toBe("Business Identity");
    expect(getSectionDisplayName("approvalMode")).toBe("Approval Mode");
  });
});
