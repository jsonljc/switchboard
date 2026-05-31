import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiraDeskPage } from "../mira-desk-page";

const deskMock = vi.fn();
vi.mock("@/hooks/use-mira-desk", () => ({ useMiraDesk: () => deskMock() }));
vi.mock("@/hooks/use-agent-greeting", () => ({ useAgentGreeting: () => ({ data: null }) }));
vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, toggleHalt: vi.fn() }),
}));

const FORBIDDEN =
  /\b(sent to riley|in use|winner|fatigued|published|distribute|performance|learning|improved|drove|recovered|saved)\b/i;

const counts = {
  total: 0,
  shippedThisWeek: 0,
  shippedPrevWeek: 0,
  inFlight: 0,
  awaitingReview: 0,
  stopped: 0,
};

describe("MiraDeskPage", () => {
  beforeEach(() => deskMock.mockReset());

  it("renders the in-production tray and the ready-to-review hero from the desk model", () => {
    deskMock.mockReturnValue({
      data: {
        inProduction: [
          { id: "p", title: "Promo", stage: "production", state: "in_production", updatedAt: "x" },
        ],
        readyToReviewCount: 2,
        counts: { ...counts, total: 3, inFlight: 1 },
        isEmpty: false,
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<MiraDeskPage />);
    expect(screen.getByText(/2 drafts ready/i)).toBeInTheDocument();
    expect(screen.getByText(/generating draft/i)).toBeInTheDocument();
  });

  it("shows a loading state while keys are pending (data undefined, no error)", () => {
    deskMock.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null });
    render(<MiraDeskPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument(); // gated on !data && !error, not isLoading
  });

  it("never renders a forbidden Phase-4/5 word", () => {
    deskMock.mockReturnValue({
      data: { inProduction: [], readyToReviewCount: 0, counts, isEmpty: true },
      isLoading: false,
      isError: false,
      error: null,
    });
    const { container } = render(<MiraDeskPage />);
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN);
  });
});
