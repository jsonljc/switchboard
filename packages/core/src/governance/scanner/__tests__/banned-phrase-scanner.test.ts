import { describe, it, expect } from "vitest";
import { scanForBannedPhrases } from "../banned-phrase-scanner.js";
import type { BannedPhraseEntry } from "../../banned-phrases/types.js";

const ENTRIES: BannedPhraseEntry[] = [
  {
    id: "g1",
    category: "guarantee",
    patterns: ["guaranteed"],
    severity: "block",
  },
  {
    id: "g2",
    category: "guarantee",
    patterns: [/\bpermanent\b/i],
    severity: "block",
  },
  {
    id: "s1",
    category: "superlative",
    patterns: [/\bbest results\b/i],
    severity: "block",
  },
];

describe("scanForBannedPhrases", () => {
  it("matches a string substring case-insensitively", () => {
    const matches = scanForBannedPhrases("This treatment is GUARANTEED.", ENTRIES);
    expect(matches).toHaveLength(1);
    const match = matches[0];
    expect(match).toBeDefined();
    expect(match!.entry.id).toBe("g1");
    expect(match!.matched.toLowerCase()).toBe("guaranteed");
  });

  it("matches a regex pattern", () => {
    const matches = scanForBannedPhrases("Results are permanent.", ENTRIES);
    expect(matches).toHaveLength(1);
    const match = matches[0];
    expect(match).toBeDefined();
    expect(match!.entry.id).toBe("g2");
  });

  it("returns no match on a clean string", () => {
    const matches = scanForBannedPhrases(
      "Our consultation includes an honest assessment.",
      ENTRIES,
    );
    expect(matches).toHaveLength(0);
  });

  it("does not match anchored superlative on innocent contexts", () => {
    const matches = scanForBannedPhrases("This is our best practice for follow-up.", ENTRIES);
    expect(matches).toHaveLength(0);
  });

  it("matches anchored superlative in marketing context", () => {
    const matches = scanForBannedPhrases("You'll see the best results in 4 weeks.", ENTRIES);
    expect(matches).toHaveLength(1);
    const match = matches[0];
    expect(match).toBeDefined();
    expect(match!.entry.id).toBe("s1");
  });

  it("collects multiple matches across different entries", () => {
    const matches = scanForBannedPhrases(
      "It's guaranteed and the best results are permanent.",
      ENTRIES,
    );
    const ids = matches.map((m) => m.entry.id).sort();
    expect(ids).toEqual(["g1", "g2", "s1"]);
  });

  it("does not double-match across repeated regex calls (no g-flag drift)", () => {
    const entry: BannedPhraseEntry = {
      id: "x",
      category: "guarantee",
      patterns: [new RegExp("permanent", "i")],
      severity: "block",
    };
    const matches1 = scanForBannedPhrases("permanent permanent permanent", [entry]);
    const matches2 = scanForBannedPhrases("permanent permanent permanent", [entry]);
    expect(matches1.length).toBeGreaterThan(0);
    expect(matches2.length).toBe(matches1.length);
  });
});
