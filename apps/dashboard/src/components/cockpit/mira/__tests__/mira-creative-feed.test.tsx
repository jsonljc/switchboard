import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MiraCreativeJobSummary } from "@switchboard/core";

const feed = vi.fn();
vi.mock("@/hooks/use-mira-feed", () => ({ useMiraFeed: () => feed() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { MiraCreativeFeed } from "../mira-creative-feed";

function clip(id: string): MiraCreativeJobSummary {
  return {
    id,
    title: `Clip ${id}`,
    stage: "production",
    status: "awaiting_review",
    draft: { videoUrl: `https://x/${id}.mp4` },
    reviewAction: { canContinue: true, canStop: true, label: "continue_draft" },
    source: { engine: "legacy_creative_job", mode: "polished" },
    createdAt: "2026-05-27T00:00:00Z",
    updatedAt: "2026-05-27T00:00:00Z",
  };
}

describe("MiraCreativeFeed", () => {
  it("renders a card per job", () => {
    feed.mockReturnValue({
      data: {
        jobs: [clip("a"), clip("b")],
        counts: {},
        feed: { reviewableCount: 2, renderingCount: 0 },
      },
      isLoading: false,
      isError: false,
    });
    render(<MiraCreativeFeed />);
    expect(screen.getAllByTestId("mira-clip")).toHaveLength(2);
  });

  it("empty → honest empty state", () => {
    feed.mockReturnValue({
      data: { jobs: [], counts: {}, feed: { reviewableCount: 0, renderingCount: 0 } },
      isLoading: false,
      isError: false,
    });
    render(<MiraCreativeFeed />);
    expect(screen.getByText(/No drafts to review yet/i)).toBeInTheDocument();
  });

  it("loading → skeleton, not empty copy", () => {
    feed.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<MiraCreativeFeed />);
    expect(screen.queryByText(/No drafts to review yet/i)).toBeNull();
    expect(screen.getByTestId("mira-feed-skeleton")).toBeInTheDocument();
  });

  it("error → retry card", () => {
    feed.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<MiraCreativeFeed />);
    expect(screen.getByText(/Couldn't load/i)).toBeInTheDocument();
  });
});
