import { describe, expect, it } from "vitest";
import { PipelineBoardResponseSchema } from "@switchboard/schemas";
import { PIPELINE_FIXTURE_ROWS } from "../fixtures";

describe("PIPELINE_FIXTURE_ROWS", () => {
  it("has 20 rows", () => {
    expect(PIPELINE_FIXTURE_ROWS).toHaveLength(20);
  });

  it("parses cleanly through PipelineBoardResponseSchema", () => {
    expect(() => PipelineBoardResponseSchema.parse({ rows: PIPELINE_FIXTURE_ROWS })).not.toThrow();
  });

  it("covers every stage at least once", () => {
    const stages = new Set(PIPELINE_FIXTURE_ROWS.map((r) => r.stage));
    expect(stages).toEqual(
      new Set([
        "interested",
        "qualified",
        "quoted",
        "booked",
        "showed",
        "won",
        "lost",
        "nurturing",
      ]),
    );
  });
});
