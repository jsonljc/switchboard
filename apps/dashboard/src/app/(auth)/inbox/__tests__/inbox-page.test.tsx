import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: vi.fn(),
}));

import { useDecisionFeed } from "@/hooks/use-decision-feed";
import InboxPage from "../page";

const mockFeed = useDecisionFeed as ReturnType<typeof vi.fn>;

describe("InboxPage", () => {
  it("renders loading state", () => {
    mockFeed.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<InboxPage />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("renders error state and NOT the empty state", () => {
    mockFeed.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<InboxPage />);
    expect(screen.getByText(/Couldn't load your inbox/i)).toBeInTheDocument();
    expect(screen.queryByText(/That's everything/i)).toBeNull();
  });

  it("renders empty state when there are no decisions", () => {
    mockFeed.mockReturnValue({
      data: { decisions: [] },
      isLoading: false,
      isError: false,
    });
    render(<InboxPage />);
    expect(screen.getByText(/That's everything/i)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load your inbox/i)).toBeNull();
  });

  it("renders decision list when decisions are present", () => {
    mockFeed.mockReturnValue({
      data: {
        decisions: [
          { id: "d1", humanSummary: "Approve campaign spend" },
          { id: "d2", humanSummary: "Review ad copy" },
        ],
      },
      isLoading: false,
      isError: false,
    });
    render(<InboxPage />);
    expect(screen.getByText("Approve campaign spend")).toBeInTheDocument();
    expect(screen.getByText("Review ad copy")).toBeInTheDocument();
    expect(screen.queryByText(/That's everything/i)).toBeNull();
    expect(screen.queryByText(/Couldn't load your inbox/i)).toBeNull();
  });
});
