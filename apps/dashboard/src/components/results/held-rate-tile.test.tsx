import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture, quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { buildResultsModel } from "./results-model";
import { HeldRateTile } from "./held-rate-tile";

describe("HeldRateTile", () => {
  it("renders the held rate as a percent for a populated period", () => {
    const model = buildResultsModel(goodFixture); // 38 / 45 ≈ 84.44%
    const { container } = render(<HeldRateTile model={model} />);
    expect(container.textContent).toContain("84.44%");
  });

  it("renders an em-dash placeholder when there are no matured bookings (rate null)", () => {
    const model = buildResultsModel(quietFixture); // { attended: 0, matured: 0, rate: null }
    const { container } = render(<HeldRateTile model={model} />);
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("%");
  });

  it("shows the attended-of-matured cohort beneath the rate", () => {
    const model = buildResultsModel(goodFixture);
    const { container } = render(<HeldRateTile model={model} />);
    expect(container.textContent).toContain("38 of 45");
  });
});
