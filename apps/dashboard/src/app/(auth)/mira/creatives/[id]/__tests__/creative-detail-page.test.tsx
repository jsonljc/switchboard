import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MiraCreativeJobSummary } from "@switchboard/core";

const mockCreative = vi.fn();
const mockMutate = vi.fn();
const mockEstimate = vi.fn();
const mockApprove: {
  mutate: typeof mockMutate;
  isPending: boolean;
  isError: boolean;
  data?: { pendingApproval: boolean };
} = { mutate: mockMutate, isPending: false, isError: false, data: undefined };
vi.mock("@/hooks/use-mira-creative", () => ({ useMiraCreative: () => mockCreative() }));
vi.mock("@/hooks/use-creative-pipeline", () => ({
  useApproveStage: () => mockApprove,
  useCostEstimate: () => mockEstimate(),
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
  beforeEach(() => {
    mockCreative.mockReset();
    mockMutate.mockReset();
    mockEstimate.mockReset();
    mockEstimate.mockReturnValue({ data: null });
    mockApprove.data = undefined;
  });

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
      .filter((el) => !el.textContent?.toLowerCase().includes("not published"));
    expect(publishTexts).toHaveLength(0);
  });

  it("continue requires confirm before mutating", () => {
    mockCreative.mockReturnValue({
      data: summary({
        reviewAction: { canContinue: true, canStop: false, label: "review_draft" },
        draft: { videoUrl: "https://x/p.mp4" },
      }),
      isLoading: false,
      isError: false,
    });
    render(<MiraCreativeDetailPage id="j" />);
    // Click the primary "Continue draft" button — confirm panel should appear, no mutation yet
    fireEvent.click(screen.getByRole("button", { name: "Continue draft" }));
    expect(mockMutate).not.toHaveBeenCalled();
    // Click the "Confirm continue" button — mutation fires with correct args
    fireEvent.click(screen.getByRole("button", { name: "Confirm continue" }));
    expect(mockMutate).toHaveBeenCalledWith({ jobId: "j", action: "continue" });
  });

  it("continue confirm shows the cost-readback breakdown when an estimate is present", () => {
    mockEstimate.mockReturnValue({ data: { basic: { cost: 12 } } });
    mockCreative.mockReturnValue({
      data: summary({
        reviewAction: { canContinue: true, canStop: false, label: "review_draft" },
        draft: { videoUrl: "https://x/p.mp4" },
      }),
      isLoading: false,
      isError: false,
    });
    render(<MiraCreativeDetailPage id="j" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue draft" }));
    // PR-B financial-breakdown: labeled "Provider cost" readback reusing the
    // existing `about $X` string on the var(--canvas-2) inset.
    expect(screen.getByText("Provider cost")).toBeInTheDocument();
    expect(screen.getByText("about $12")).toBeInTheDocument();
  });

  it("stop requires an irreversible confirm before mutating", () => {
    mockCreative.mockReturnValue({
      data: summary({
        reviewAction: { canContinue: false, canStop: true, label: "review_draft" },
        draft: { videoUrl: "https://x/p.mp4" },
      }),
      isLoading: false,
      isError: false,
    });
    render(<MiraCreativeDetailPage id="j" />);
    // Click "Stop draft" — confirm panel appears with irreversibility copy, no mutation yet
    fireEvent.click(screen.getByRole("button", { name: "Stop draft" }));
    expect(screen.getByText(/can't be undone/i)).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
    // Click the confirm "Stop draft" button inside the confirm panel — mutation fires
    // There are now two "Stop draft" buttons: the original is gone (confirm==="stop"),
    // and the confirm panel's button is shown instead.
    fireEvent.click(screen.getByRole("button", { name: "Stop draft" }));
    expect(mockMutate).toHaveBeenCalledWith({ jobId: "j", action: "stop" });
  });

  it("shows a pending-approval notice (not a completion) when a render is parked over the spend limit", () => {
    mockApprove.data = { pendingApproval: true };
    mockCreative.mockReturnValue({
      data: summary({
        reviewAction: { canContinue: true, canStop: true, label: "review_draft" },
        draft: { videoUrl: "https://x/p.mp4" },
      }),
      isLoading: false,
      isError: false,
    });
    render(<MiraCreativeDetailPage id="j" />);
    expect(screen.getByText(/needs your sign-off|Queued for your approval/i)).toBeTruthy();
    // Not framed as a failure.
    expect(screen.queryByText(/try again/i)).toBeNull();
  });

  it("shows 'Draft not found' (not load-error) when data is undefined and no error", () => {
    mockCreative.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    render(<MiraCreativeDetailPage id="j" />);
    expect(screen.getByText(/Draft not found/i)).toBeTruthy();
    expect(screen.queryByText(/load this draft/i)).toBeNull();
  });

  it("shows load-error copy (not not-found) when isError is true", () => {
    mockCreative.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<MiraCreativeDetailPage id="j" />);
    expect(screen.getByText(/load this draft/i)).toBeTruthy();
    expect(screen.queryByText(/Draft not found/i)).toBeNull();
  });

  describe("performance block (slice-2 measured attribution)", () => {
    it("renders nothing when the summary has no performance projection", () => {
      mockCreative.mockReturnValue({
        data: summary({ draft: { videoUrl: "https://x/p.mp4" } }),
        isLoading: false,
        isError: false,
      });
      render(<MiraCreativeDetailPage id="j" />);
      expect(screen.queryByText("Performance")).toBeNull();
    });

    it("renders 'No delivery yet' for a published-but-parked creative", () => {
      mockCreative.mockReturnValue({
        data: summary({
          draft: { videoUrl: "https://x/p.mp4" },
          performance: {
            asOf: "2026-06-04T06:30:00.000Z",
            delivery: "no_delivery",
            spend: 0,
            trueRoas: null,
            bookedValueCents: 0,
            bookedCount: 0,
            metaConversions: 0,
          },
        }),
        isLoading: false,
        isError: false,
      });
      render(<MiraCreativeDetailPage id="j" />);
      expect(screen.getByText("Performance")).toBeInTheDocument();
      expect(screen.getByText(/No delivery yet/i)).toBeInTheDocument();
    });

    it("renders measured numbers WITH the as-of date (never an undated number)", () => {
      mockCreative.mockReturnValue({
        data: summary({
          draft: { videoUrl: "https://x/p.mp4" },
          performance: {
            asOf: "2026-06-04T06:30:00.000Z",
            delivery: "measured",
            spend: 50,
            trueRoas: 5,
            bookedValueCents: 25000,
            bookedCount: 2,
            metaConversions: 3,
          },
        }),
        isLoading: false,
        isError: false,
      });
      render(<MiraCreativeDetailPage id="j" />);
      expect(screen.getByText("Performance")).toBeInTheDocument();
      expect(screen.getByText(/\$50\.00 spent/)).toBeInTheDocument();
      expect(screen.getByText(/5\.0x trueROAS/)).toBeInTheDocument();
      expect(screen.getByText(/\$250\.00 booked \(2\)/)).toBeInTheDocument();
      expect(screen.getByText(/3 Meta-reported conversions/)).toBeInTheDocument();
      expect(screen.getByText(/as of Jun 4, 2026/)).toBeInTheDocument();
    });

    it("renders measured-with-no-bookings honestly (no fabricated 0x)", () => {
      mockCreative.mockReturnValue({
        data: summary({
          draft: { videoUrl: "https://x/p.mp4" },
          performance: {
            asOf: "2026-06-04T06:30:00.000Z",
            delivery: "measured",
            spend: 12.5,
            trueRoas: null,
            bookedValueCents: 0,
            bookedCount: 0,
            metaConversions: 1,
          },
        }),
        isLoading: false,
        isError: false,
      });
      render(<MiraCreativeDetailPage id="j" />);
      expect(screen.getByText(/\$12\.50 spent/)).toBeInTheDocument();
      expect(screen.getByText(/no booked revenue attributed yet/i)).toBeInTheDocument();
      expect(screen.queryByText(/0\.0x trueROAS/)).toBeNull();
      expect(screen.getByText(/as of Jun 4, 2026/)).toBeInTheDocument();
    });
  });
});
