import { describe, it, expect } from "vitest";
import { extractCreativeDescriptor } from "./creative-descriptor.js";

const HOOKS = {
  hooks: [
    {
      angleRef: "0",
      text: "Stop scrolling",
      type: "pattern_interrupt",
      platformScore: 8,
      rationale: "r",
    },
    { angleRef: "0", text: "What if?", type: "question", platformScore: 9, rationale: "r" },
    { angleRef: "1", text: "Bold claim", type: "bold_statement", platformScore: 7, rationale: "r" },
  ],
  topCombos: [{ angleRef: "0", hookRef: "2", score: 9 }],
};

function scripts(hookRef: string) {
  return {
    scripts: [
      {
        hookRef,
        fullScript: "s",
        timing: [{ section: "hook", startSec: 0, endSec: 3, content: "c" }],
        format: "feed_video",
        platform: "meta",
        productionNotes: "n",
      },
    ],
  };
}

describe("extractCreativeDescriptor", () => {
  it("resolves the LEADING script's hookRef (0-based index string)", () => {
    const d = extractCreativeDescriptor({ hooks: HOOKS, scripts: scripts("1") }, "polished");
    expect(d).toEqual({ mode: "polished", hookType: "question" });
  });

  it("falls back to topCombos[0].hookRef on a non-numeric legacy ref", () => {
    const d = extractCreativeDescriptor({ hooks: HOOKS, scripts: scripts("hook-a") }, "polished");
    expect(d).toEqual({ mode: "polished", hookType: "bold_statement" });
  });

  it("falls back to hooks[0].type when both refs are unresolvable", () => {
    const badCombos = { ...HOOKS, topCombos: [{ angleRef: "0", hookRef: "99", score: 9 }] };
    const d = extractCreativeDescriptor(
      { hooks: badCombos, scripts: scripts("not-a-number") },
      "polished",
    );
    expect(d).toEqual({ mode: "polished", hookType: "pattern_interrupt" });
  });

  it("out-of-range script ref falls through the chain", () => {
    const d = extractCreativeDescriptor({ hooks: HOOKS, scripts: scripts("99") }, "polished");
    expect(d).toEqual({ mode: "polished", hookType: "bold_statement" });
  });

  it("returns none when no hook stage output exists (e.g. UGC v1)", () => {
    expect(extractCreativeDescriptor({}, "ugc")).toEqual({ mode: "ugc", hookType: "none" });
    expect(extractCreativeDescriptor(null, "ugc")).toEqual({ mode: "ugc", hookType: "none" });
    expect(extractCreativeDescriptor(undefined, "polished")).toEqual({
      mode: "polished",
      hookType: "none",
    });
  });

  it("reads the leading spec's structureId for ugc outputs (slice-3 spec 3.4)", () => {
    const d = extractCreativeDescriptor(
      {
        scripting: {
          specs: [
            { structureId: "demo_first", specId: "s1" },
            { structureId: "confession", specId: "s2" },
          ],
        },
      },
      "ugc",
    );
    expect(d).toEqual({ mode: "ugc", hookType: "none", structureId: "demo_first" });
  });

  it("OMITS structureId for polished (the exact toEqual pins above depend on it)", () => {
    const d = extractCreativeDescriptor({}, "polished");
    expect("structureId" in d).toBe(false);
  });

  it("ugc with unparseable scripting output stays the none bucket without a structure", () => {
    const d = extractCreativeDescriptor({ scripting: { specs: "garbage" } }, "ugc");
    expect(d).toEqual({ mode: "ugc", hookType: "none" });
  });

  it("returns none on malformed stage outputs (parse-don't-cast, never throws)", () => {
    expect(
      extractCreativeDescriptor({ hooks: { hooks: "junk" }, scripts: 42 }, "polished"),
    ).toEqual({ mode: "polished", hookType: "none" });
  });

  it("missing scripts output uses topCombos directly", () => {
    const d = extractCreativeDescriptor({ hooks: HOOKS }, "polished");
    expect(d).toEqual({ mode: "polished", hookType: "bold_statement" });
  });
});
