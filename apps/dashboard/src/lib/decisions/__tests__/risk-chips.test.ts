import { describe, it, expect } from "vitest";
import { riskChips } from "../risk-chips";

describe("riskChips", () => {
  it("returns a single needs-review chip when the contract is absent", () => {
    const chips = riskChips(undefined);
    expect(chips).toEqual([
      { key: "missing", label: "Needs review before this can run", strong: true },
    ]);
  });
  it("maps each boolean flag to a plain-English chip", () => {
    const chips = riskChips({
      riskLevel: "high",
      financialEffect: true,
      externalEffect: true,
      clientFacing: true,
      requiresConfirmation: true,
    });
    expect(chips.map((c) => c.key)).toEqual(["fin", "ext", "cli", "conf"]);
  });
  it("returns a soft 'no side effects' chip when nothing is flagged", () => {
    const chips = riskChips({
      riskLevel: "low",
      financialEffect: false,
      externalEffect: false,
      clientFacing: false,
      requiresConfirmation: false,
    });
    expect(chips).toEqual([
      { key: "safe", label: "No side effects outside Switchboard", soft: true },
    ]);
  });
});
