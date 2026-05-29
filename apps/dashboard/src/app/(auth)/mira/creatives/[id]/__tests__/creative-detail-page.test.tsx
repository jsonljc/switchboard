import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MiraCreativeJobSummary } from "@switchboard/core";

const mockCreative = vi.fn();
const mockApprove = { mutate: vi.fn(), isPending: false, isError: false };
vi.mock("@/hooks/use-mira-creative", () => ({ useMiraCreative: () => mockCreative() }));
vi.mock("@/hooks/use-creative-pipeline", () => ({
  useApproveStage: () => mockApprove,
  useCostEstimate: () => ({ data: null }),
}));

import { MiraCreativeDetailPage } from "../creative-detail-page";

function summary(over: Partial<MiraCreativeJobSummary>): MiraCreativeJobSummary {
  return {
    id: "j",
    title: "Spring promo",
    stage: "complete",
    status: "draft_ready",
    reviewAction: { canContinue: false, canStop: false, label: "review_draft" },
    source: { engine: "legacy_creative_job", mode: "polished" },
    createdAt: "2026-05-26T00:00:00Z",
    updatedAt: "2026-05-26T00:00:00Z",
    ...over,
  };
}

describe("MiraCreativeDetailPage (seam-backed)", () => {
  beforeEach(() => mockCreative.mockReset());

  it("renders a UGC draft clip (no 'No draft clip yet')", () => {
    mockCreative.mockReturnValue({
      data: summary({
        source: { engine: "legacy_creative_job", mode: "ugc" },
        draft: { videoUrl: "https://x/u.mp4" },
      }),
      isLoading: false,
      isError: false,
    });
    const { container } = render(<MiraCreativeDetailPage id="j" />);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("https://x/u.mp4");
    expect(screen.queryByText(/No draft clip yet/i)).toBeNull();
  });

  it("renders a polished draft clip", () => {
    mockCreative.mockReturnValue({
      data: summary({ draft: { videoUrl: "https://x/p.mp4" } }),
      isLoading: false,
      isError: false,
    });
    const { container } = render(<MiraCreativeDetailPage id="j" />);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("https://x/p.mp4");
  });

  it("never shows publish/launch copy", () => {
    mockCreative.mockReturnValue({
      data: summary({ draft: { videoUrl: "https://x/p.mp4" } }),
      isLoading: false,
      isError: false,
    });
    render(<MiraCreativeDetailPage id="j" />);
    // The banner says "not published" and "Nothing goes live" — those are negative-safety
    // assertions, not action copy. Reject affirmative publish/launch CTAs only.
    expect(
      screen.queryByText(/publish now|go live now|launch campaign|approve creative/i),
    ).toBeNull();
    // No standalone "published" outside of the draft-only disclaimer
    const publishTexts = screen
      .queryAllByText(/published/i)
      .filter((el) => !el.textContent?.includes("not published"));
    expect(publishTexts).toHaveLength(0);
  });
});
