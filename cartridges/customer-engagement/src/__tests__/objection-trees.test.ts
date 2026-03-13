// ---------------------------------------------------------------------------
// Tests: Objection Trees
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { matchObjection } from "../agents/intake/objection-trees.js";

describe("matchObjection", () => {
  it("should match price objections", () => {
    const result = matchObjection("This seems too expensive for my budget");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("price");
  });

  it("should match timing objections", () => {
    const result = matchObjection("I'm too busy right now, maybe later");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("timing");
  });

  it("should match trust objections", () => {
    const result = matchObjection("I need to check your reviews and credentials");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("trust");
  });

  it("should match comfort objections", () => {
    const result = matchObjection("I'm nervous and anxious about this");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("comfort");
  });

  it("should match results objections", () => {
    const result = matchObjection("How long do the results last?");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("results");
  });

  it("should match insurance objections", () => {
    const result = matchObjection("Is this covered by my insurance?");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("insurance");
  });

  it("should match downtime objections", () => {
    const result = matchObjection("What's the recovery time? I can't take time off work");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("downtime");
  });

  it("should return null for unmatched text", () => {
    const result = matchObjection("What's the weather like today?");
    expect(result).toBeNull();
  });

  it("should prefer higher-scoring matches", () => {
    // "expensive" + "budget" + "money" = price category (3 matches)
    const result = matchObjection("This is too expensive for my budget, I don't have the money");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("price");
  });

  it("should include response and followUp", () => {
    const result = matchObjection("How much does it cost?");
    expect(result).not.toBeNull();
    expect(result!.response.length).toBeGreaterThan(0);
    expect(result!.followUp.length).toBeGreaterThan(0);
  });
});
