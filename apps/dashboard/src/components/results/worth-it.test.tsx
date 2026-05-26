import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { goodFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { WorthIt } from "./worth-it";

describe("WorthIt", () => {
  it("renders the three cost cells in dollars", () => {
    render(<WorthIt cost={goodFixture.cost} narrative={goodFixture.costNarrative} />);
    expect(screen.getByText("S$612")).toBeInTheDocument(); // you pay (subscription)
    expect(screen.getByText("S$8,000")).toBeInTheDocument(); // alt
    expect(screen.getByText("S$7,388")).toBeInTheDocument(); // saved
  });
  it("labels the alternative as a market-rate estimate", () => {
    render(<WorthIt cost={goodFixture.cost} narrative={goodFixture.costNarrative} />);
    expect(screen.getByText(/market-rate estimate/i)).toBeInTheDocument();
  });
  it("renders the cost narrative", () => {
    render(<WorthIt cost={goodFixture.cost} narrative={goodFixture.costNarrative} />);
    expect(screen.getByText(goodFixture.costNarrative)).toBeInTheDocument();
  });
});
