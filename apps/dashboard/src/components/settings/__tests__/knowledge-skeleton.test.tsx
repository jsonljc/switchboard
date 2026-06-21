import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KnowledgeSkeleton } from "../knowledge-skeleton";

describe("KnowledgeSkeleton - shared Skeleton composition (audit B1)", () => {
  it("renders the shared Skeleton blocks (aria-hidden decorative) - no hand-rolled bg-muted", () => {
    const { container } = render(<KnowledgeSkeleton />);

    // The shared Skeleton is aria-hidden="true"; there must be at least one.
    const hiddenEls = container.querySelectorAll('[aria-hidden="true"]');
    expect(hiddenEls.length).toBeGreaterThan(0);

    // The hand-rolled approach used inline class bg-muted; it must NOT appear.
    const bgMutedEls = container.querySelectorAll(".bg-muted");
    expect(bgMutedEls.length).toBe(0);

    // The wrapper preserves the original test id for importers.
    expect(screen.getByTestId("knowledge-skeleton")).toBeInTheDocument();
  });
});
