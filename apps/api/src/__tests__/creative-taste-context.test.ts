import { describe, it, expect, vi } from "vitest";
import { buildCreativeTasteProvider } from "../services/creative-taste-context.js";
import { SURFACING_THRESHOLD } from "@switchboard/schemas";

function store(rows: Array<Record<string, unknown>>) {
  return { listHighConfidence: vi.fn().mockResolvedValue(rows) };
}

describe("buildCreativeTasteProvider", () => {
  it("queries the standard surfacing thresholds and renders taste buckets as subjective lines", async () => {
    const s = store([
      {
        id: "m1",
        category: "taste",
        canonicalKey: "taste:kept_polished_question",
        sourceCount: 4,
        confidence: 0.7,
      },
      {
        id: "m2",
        category: "faq",
        canonicalKey: null,
        sourceCount: 9,
        confidence: 0.9,
      },
    ]);
    const provider = buildCreativeTasteProvider(s as never);

    const lines = await provider.getTasteContext("org-1", "dep-1");

    expect(s.listHighConfidence).toHaveBeenCalledWith(
      "org-1",
      "dep-1",
      SURFACING_THRESHOLD.minConfidence,
      SURFACING_THRESHOLD.minSourceCount,
    );
    expect(lines).toEqual(["consistently keeps question hooks in polished mode (4 keeps)"]);
  });

  it("renders pass buckets and the no-hook segment", async () => {
    const s = store([
      {
        id: "m1",
        category: "taste",
        canonicalKey: "taste:passed_ugc_none",
        sourceCount: 3,
        confidence: 0.66,
      },
    ]);
    const provider = buildCreativeTasteProvider(s as never);
    expect(await provider.getTasteContext("o", "d")).toEqual([
      "consistently passes creatives with no leading hook in ugc mode (3 passes)",
    ]);
  });

  it("skips malformed canonical keys and non-taste rows; empty result is an empty array", async () => {
    const s = store([
      {
        id: "m1",
        category: "taste",
        canonicalKey: "not-a-taste-key",
        sourceCount: 5,
        confidence: 0.8,
      },
      { id: "m2", category: "taste", canonicalKey: null, sourceCount: 5, confidence: 0.8 },
      {
        id: "m3",
        category: "pattern",
        canonicalKey: "objection:price_value",
        sourceCount: 5,
        confidence: 0.8,
      },
    ]);
    const provider = buildCreativeTasteProvider(s as never);
    expect(await provider.getTasteContext("o", "d")).toEqual([]);
  });
});
