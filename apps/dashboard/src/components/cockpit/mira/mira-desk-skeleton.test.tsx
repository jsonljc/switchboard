import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MiraDeskSkeleton } from "./mira-desk-skeleton";

afterEach(cleanup);

describe("MiraDeskSkeleton", () => {
  it("renders a labelled loading status with ≥3 placeholder blocks", () => {
    const { container } = render(<MiraDeskSkeleton />);
    expect(screen.getByRole("status", { name: /loading mira/i })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-skeleton-block]").length).toBeGreaterThanOrEqual(3);
  });
});
