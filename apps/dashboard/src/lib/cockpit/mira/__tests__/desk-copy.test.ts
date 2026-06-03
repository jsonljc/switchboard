import { describe, it, expect } from "vitest";
import { STAGE_COPY, PROBLEM_COPY, DESK_COPY } from "../desk-copy";

const BANNED =
  /\b(publish|launch|distribute|performance|winner|fatigued|learning|improved|drove|recovered|saved)\b/i;

describe("desk copy guardrails", () => {
  it("maps every pipeline stage to plain status copy", () => {
    expect(STAGE_COPY.trends).toMatch(/concept|idea/i);
    expect(STAGE_COPY.production).toMatch(/draft/i);
    expect(STAGE_COPY.complete).toMatch(/ready/i);
  });

  it("maps the quality_failed problem to a plain message", () => {
    expect(PROBLEM_COPY.quality_failed).toMatch(/quality/i);
  });

  it("contains NO Phase-2 banned words anywhere", () => {
    const all = [
      ...Object.values(STAGE_COPY),
      ...Object.values(PROBLEM_COPY),
      ...Object.values(DESK_COPY),
    ].join(" | ");
    expect(all).not.toMatch(BANNED);
  });
});
