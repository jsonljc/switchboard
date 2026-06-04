/**
 * Slice-2 category pin (spec 3.4): conversation extraction must NEVER emit the
 * creative-loop memory categories. The fact-extraction prompt hardcodes the
 * legacy five; widening DeploymentMemoryCategorySchema (taste, revenue_proven)
 * must not widen what the extractor is invited to produce. The extractor's
 * output is cast, not enum-parsed (compounding-service), so the prompt IS the
 * gate; this test pins it.
 */
import { describe, it, expect } from "vitest";
import { buildFactExtractionPrompt } from "../extraction-prompts.js";

describe("fact-extraction prompt category pin", () => {
  const prompt = buildFactExtractionPrompt(
    [{ role: "user", content: "Do you have weekend availability?" }],
    ["objection:price_value"],
  );

  it("invites exactly the legacy five categories", () => {
    expect(prompt).toContain("preference|faq|objection|pattern|fact");
  });

  it("never invites the creative-loop categories", () => {
    expect(prompt).not.toContain("taste");
    expect(prompt).not.toContain("revenue_proven");
  });
});
