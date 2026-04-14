import { describe, it, expect } from "vitest";
import { getToolGovernanceDecision } from "./types.js";

describe("getToolGovernanceDecision", () => {
  it("requires approval for crm-write.stage.update in supervised mode", () => {
    expect(getToolGovernanceDecision("crm-write.stage.update", "supervised")).toBe(
      "require-approval",
    );
  });

  it("auto-approves crm-write.stage.update in guided mode", () => {
    expect(getToolGovernanceDecision("crm-write.stage.update", "guided")).toBe("auto-approve");
  });

  it("auto-approves crm-write.stage.update in autonomous mode", () => {
    expect(getToolGovernanceDecision("crm-write.stage.update", "autonomous")).toBe("auto-approve");
  });

  it("auto-approves all read operations in supervised mode", () => {
    expect(getToolGovernanceDecision("crm-query.contact.get", "supervised")).toBe("auto-approve");
    expect(getToolGovernanceDecision("crm-query.activity.list", "supervised")).toBe("auto-approve");
    expect(getToolGovernanceDecision("pipeline-handoff.determine", "supervised")).toBe(
      "auto-approve",
    );
  });

  it("auto-approves crm-write.activity.log in supervised mode", () => {
    expect(getToolGovernanceDecision("crm-write.activity.log", "supervised")).toBe("auto-approve");
  });
});
