import { describe, it, expect } from "vitest";
import type { Decision } from "./types";

// Pins the hand-mirrored producer->consumer seam: this object literal fails to
// typecheck if the dashboard Decision.meta drops a field the core adapter sets.
describe("decision wire shape", () => {
  it("meta carries the evidence-first fields produced by the core recommendation adapter", () => {
    const meta: Decision["meta"] = { dollarsAtRisk: 450, confidence: 0.82 };
    expect(meta.dollarsAtRisk).toBe(450);
    expect(meta.confidence).toBe(0.82);
  });
});
