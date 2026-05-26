import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { buildResultsModel } from "./results-model";
import { HeroOutcomes } from "./hero-outcomes";

describe("HeroOutcomes", () => {
  // goodFixture: attribution.total = 14720, funnel Bookings.n = 47,
  // Σ campaigns[].spend = 620+410+217+168+412+285 = 2112, cost.paid = 612
  const model = buildResultsModel(goodFixture);

  it("shows booked revenue in whole SGD dollars (no /100, no bare $)", () => {
    const { container } = render(<HeroOutcomes model={model} />);
    expect(container.textContent).toContain("S$14,720");
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
    expect(container.textContent).not.toContain("147.20"); // cents/100 bug guard
  });

  it("shows consults from the Bookings stage", () => {
    const { container } = render(<HeroOutcomes model={model} />);
    expect(container.textContent).toContain("47");
  });

  it("shows ad spend as Σ campaign spend, NOT cost.paid", () => {
    const { container } = render(<HeroOutcomes model={model} />);
    expect(container.textContent).toContain("S$2,112"); // Σ campaign spend
    expect(container.textContent).not.toContain("S$612"); // cost.paid (subscription) must NOT appear here
  });

  it("renders NO return ratio and NO avg/consult", () => {
    const { container } = render(<HeroOutcomes model={model} />);
    expect(container.textContent).not.toMatch(/×/);
    expect(container.textContent?.toLowerCase()).not.toContain("per consult");
  });
});
