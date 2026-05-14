import { describe, it, expect } from "vitest";
import { coldStateActivityRows } from "../cold-state-activity-rows";

describe("coldStateActivityRows", () => {
  it("returns exactly 3 synthetic rows", () => {
    expect(coldStateActivityRows()).toHaveLength(3);
  });

  it("first row prompts Meta Ads connection", () => {
    const [row] = coldStateActivityRows();
    expect(row.kind).toBe("alert");
    expect(row.head).toMatch(/Connect Meta Ads/i);
    expect(row.time).toBe("—");
  });

  it("second row prompts setting average lead value", () => {
    const [, row] = coldStateActivityRows();
    expect(row.head).toMatch(/lead value/i);
    expect(row.time).toBe("—");
  });

  it("third row signals standing rules loaded", () => {
    const [, , row] = coldStateActivityRows();
    expect(row.kind).toBe("started");
    expect(row.head).toMatch(/rules/i);
    expect(row.time).toBe("—");
  });
});
