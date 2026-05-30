import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock all hooks so no providers are needed
const feedFn = vi.fn();
vi.mock("@/hooks/use-mira-feed", () => ({ useMiraFeed: () => feedFn() }));
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, toggleHalt: vi.fn() }),
}));
vi.mock("@/hooks/use-agent-greeting", () => ({
  useAgentGreeting: () => ({ data: { segments: [] } }),
}));
vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => ({ data: undefined }),
}));
// Stub the feed itself so the page test focuses on the header / count line
vi.mock("../mira-creative-feed", () => ({ MiraCreativeFeed: () => null }));

import { MiraFeedPage } from "../mira-feed-page";

describe("MiraFeedPage — count line", () => {
  it('shows "1 draft to review" and no rendering text when reviewableCount=1, renderingCount=0', () => {
    feedFn.mockReturnValue({
      data: {
        jobs: [],
        counts: {},
        feed: { reviewableCount: 1, renderingCount: 0 },
      },
      isLoading: false,
      isError: false,
    });
    render(<MiraFeedPage />);
    expect(screen.getByText("1 draft to review")).toBeInTheDocument();
    expect(screen.queryByText(/still rendering/i)).toBeNull();
  });

  it('shows "3 drafts to review · 2 still rendering" when reviewableCount=3, renderingCount=2', () => {
    feedFn.mockReturnValue({
      data: {
        jobs: [],
        counts: {},
        feed: { reviewableCount: 3, renderingCount: 2 },
      },
      isLoading: false,
      isError: false,
    });
    render(<MiraFeedPage />);
    expect(screen.getByText(/3 drafts to review/i)).toBeInTheDocument();
    expect(screen.getByText(/2 still rendering/i)).toBeInTheDocument();
  });
});
