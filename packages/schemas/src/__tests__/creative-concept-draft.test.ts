import { describe, it, expect } from "vitest";
import { CreativeConceptDraftInput } from "../creative-concept-draft.js";

describe("CreativeConceptDraftInput", () => {
  it("accepts the minimal Alex->Mira brief", () => {
    const parsed = CreativeConceptDraftInput.parse({
      productDescription: "Botox for first-time clients",
      targetAudience: "women 30-45, anti-aging curious",
    });
    expect(parsed.productDescription).toBe("Botox for first-time clients");
    expect(parsed.valueContext).toBeUndefined();
  });

  it("accepts the optional valueContext", () => {
    const parsed = CreativeConceptDraftInput.parse({
      productDescription: "Lip filler",
      targetAudience: "women 25-40",
      valueContext: { estimatedValue: 45000, interestSignal: "asked about pricing twice" },
    });
    expect(parsed.valueContext?.estimatedValue).toBe(45000);
  });

  it("rejects an empty productDescription", () => {
    expect(() =>
      CreativeConceptDraftInput.parse({ productDescription: "", targetAudience: "x" }),
    ).toThrow();
  });
});
