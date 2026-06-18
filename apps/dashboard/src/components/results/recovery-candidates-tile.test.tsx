import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture, quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { buildResultsModel } from "./results-model";
import { RecoveryCandidatesTile } from "./recovery-candidates-tile";

describe("RecoveryCandidatesTile", () => {
  it("renders the no-show count for a populated period", () => {
    const model = buildResultsModel(goodFixture); // goodFixture has 5 no-shows
    const { container } = render(<RecoveryCandidatesTile model={model} />);
    expect(container.textContent).toContain("5");
  });

  it("renders 0 honestly when there are no no-shows (no em-dash for zero)", () => {
    const model = buildResultsModel(quietFixture); // quietFixture has 0 no-shows
    const { container } = render(<RecoveryCandidatesTile model={model} />);
    expect(container.textContent).toContain("0");
    expect(container.textContent).not.toContain("NaN");
  });

  it("renders a label describing the metric", () => {
    const model = buildResultsModel(goodFixture);
    const { container } = render(<RecoveryCandidatesTile model={model} />);
    expect(container.textContent).toContain("No-show appointments");
  });
});
