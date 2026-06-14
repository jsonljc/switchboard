import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture, quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { buildResultsModel } from "./results-model";
import { ConsentCompletenessTile } from "./consent-completeness-tile";

describe("ConsentCompletenessTile", () => {
  it("renders the consent rate as a percent when contacts are jurisdiction-tagged", () => {
    const model = buildResultsModel(goodFixture); // 42 / 45 ≈ 93.33%
    const { container } = render(<ConsentCompletenessTile model={model} />);
    expect(container.textContent).toContain("93.33%");
  });

  it("renders an em-dash placeholder when there are no PDPA-applicable contacts (rate null)", () => {
    const model = buildResultsModel(quietFixture); // { validConsent: 0, bookable: 0, rate: null }
    const { container } = render(<ConsentCompletenessTile model={model} />);
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("%");
  });

  it("shows the valid-of-bookable cohort beneath the rate", () => {
    const model = buildResultsModel(goodFixture);
    const { container } = render(<ConsentCompletenessTile model={model} />);
    expect(container.textContent).toContain("42 of 45");
  });

  it("frames the count as a present, total-population number (no report-window qualifier)", () => {
    const model = buildResultsModel(goodFixture);
    const { container } = render(<ConsentCompletenessTile model={model} />);
    expect(container.textContent).toContain("have consent on file");
    expect(container.textContent).not.toMatch(/this week|this month|this quarter|this period/i);
  });
});
