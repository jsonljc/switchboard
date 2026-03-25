import { describe, it, expect } from "vitest";
import { deriveContactStage } from "../contact-stage-deriver.js";
import type { OpportunityStage } from "@switchboard/schemas";

function makeOpps(...stages: OpportunityStage[]) {
  return stages.map((stage) => ({ stage }));
}

const RECENT = new Date(); // now
const OLD = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago

describe("deriveContactStage", () => {
  it("returns 'new' when no opportunities", () => {
    expect(deriveContactStage([], RECENT, 30)).toBe("new");
  });

  it("returns 'active' when has non-terminal opportunity", () => {
    expect(deriveContactStage(makeOpps("interested"), RECENT, 30)).toBe("active");
  });

  it("returns 'active' for nurturing (non-terminal)", () => {
    expect(deriveContactStage(makeOpps("nurturing"), RECENT, 30)).toBe("active");
  });

  it("returns 'customer' when has won and no active opps and recent", () => {
    expect(deriveContactStage(makeOpps("won"), RECENT, 30)).toBe("customer");
  });

  it("returns 'retained' when has won AND active opps", () => {
    expect(deriveContactStage(makeOpps("won", "interested"), RECENT, 30)).toBe("retained");
  });

  it("returns 'dormant' when all terminal and inactive", () => {
    expect(deriveContactStage(makeOpps("lost"), OLD, 30)).toBe("dormant");
  });

  it("returns 'dormant' when won but inactive too long", () => {
    expect(deriveContactStage(makeOpps("won"), OLD, 30)).toBe("dormant");
  });

  it("returns 'active' when no active opps but recent activity (v1 approximation)", () => {
    expect(deriveContactStage(makeOpps("lost"), RECENT, 30)).toBe("active");
  });

  it("respects custom threshold", () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    expect(deriveContactStage(makeOpps("lost"), thirtyOneDaysAgo, 30)).toBe("dormant");
    expect(deriveContactStage(makeOpps("lost"), thirtyOneDaysAgo, 60)).toBe("active");
  });
});
