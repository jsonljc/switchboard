import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiraDeskPage } from "../mira-desk-page";

// The Desk reads the existing feed count for its Ready-to-review CTA (PR1).
const feedMock = vi.fn();
vi.mock("@/hooks/use-mira-feed", () => ({ useMiraFeed: () => feedMock() }));
vi.mock("@/hooks/use-agent-greeting", () => ({ useAgentGreeting: () => ({ data: null }) }));
vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, toggleHalt: vi.fn() }),
}));

describe("MiraDeskPage (shell)", () => {
  beforeEach(() => feedMock.mockReset());

  it("shows the ready-to-review count and links to /mira/review", () => {
    feedMock.mockReturnValue({
      data: { feed: { reviewableCount: 4, renderingCount: 1 } },
      isLoading: false,
      isError: false,
    });
    render(<MiraDeskPage />);
    expect(screen.getByText(/4 drafts ready/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review/i })).toHaveAttribute("href", "/mira/review");
  });

  it("renders a calm empty state when nothing is ready", () => {
    feedMock.mockReturnValue({
      data: { feed: { reviewableCount: 0, renderingCount: 0 } },
      isLoading: false,
      isError: false,
    });
    render(<MiraDeskPage />);
    expect(screen.getByText(/nothing to review yet/i)).toBeInTheDocument();
  });
});
