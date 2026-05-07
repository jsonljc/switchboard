import { describe, it, expect } from "vitest";
import { isOptOutKeyword } from "../opt-out-keywords.js";

describe("isOptOutKeyword", () => {
  it.each(["stop", "STOP", "Stop", "  stop  ", "unsubscribe", "UNSUBSCRIBE", "opt out", "OPT OUT"])(
    "matches opt-out keyword %s",
    (text) => {
      expect(isOptOutKeyword(text)).toBe(true);
    },
  );

  it("collapses internal whitespace for 'opt out'", () => {
    expect(isOptOutKeyword("opt   out")).toBe(true);
    expect(isOptOutKeyword("Opt\tOut")).toBe(true);
  });

  it("does not match keyword inside a longer message", () => {
    // STOP-as-substring must not trigger — false positives are worse than false negatives here.
    expect(isOptOutKeyword("please stop by my place tomorrow")).toBe(false);
    expect(isOptOutKeyword("I want to unsubscribe me from this")).toBe(false);
  });

  it("does not match empty or whitespace-only text", () => {
    expect(isOptOutKeyword("")).toBe(false);
    expect(isOptOutKeyword("   ")).toBe(false);
  });

  it("does not match unrelated messages", () => {
    expect(isOptOutKeyword("hi")).toBe(false);
    expect(isOptOutKeyword("can you help me?")).toBe(false);
  });
});
