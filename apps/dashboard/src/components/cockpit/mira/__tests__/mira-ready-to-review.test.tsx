import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiraReadyToReview } from "../mira-ready-to-review";

describe("MiraReadyToReview", () => {
  it("links OUT to /mira/review with the count when there are drafts", () => {
    render(<MiraReadyToReview count={4} />);
    expect(screen.getByRole("link", { name: /review/i })).toHaveAttribute("href", "/mira/review");
    expect(screen.getByText(/4 drafts ready/i)).toBeInTheDocument();
  });

  it("shows a calm empty state at zero (no link)", () => {
    render(<MiraReadyToReview count={0} />);
    expect(screen.getByText(/nothing to review yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
