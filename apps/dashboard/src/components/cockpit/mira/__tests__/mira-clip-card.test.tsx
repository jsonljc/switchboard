import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MiraCreativeJobSummary } from "@switchboard/core";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, toggleHalt: vi.fn() }),
}));
vi.mock("@/hooks/use-creative-pipeline", () => ({
  useApproveStage: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCostEstimate: () => ({ data: null }),
}));
// MiraClipActions (rendered by MiraClipCard) now calls useReviewDecision for the
// Keep/Pass branch — mock it so the card tests don't need a QueryClientProvider.
vi.mock("@/hooks/use-review-decision", () => ({
  useReviewDecision: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

import { MiraClipCard } from "../mira-clip-card";

function clip(over: Partial<MiraCreativeJobSummary> = {}): MiraCreativeJobSummary {
  return {
    id: "j1",
    title: "Spring promo",
    stage: "production",
    status: "awaiting_review",
    draft: { videoUrl: "https://x/v.mp4" },
    reviewAction: { canContinue: true, canStop: true, label: "continue_draft" },
    source: { engine: "legacy_creative_job", mode: "ugc" },
    createdAt: "2026-05-27T00:00:00Z",
    updatedAt: "2026-05-27T00:00:00Z",
    ...over,
  };
}

afterEach(() => push.mockReset());

describe("MiraClipCard", () => {
  it("renders the video and a mode-correct status chip", () => {
    const { container } = render(
      <MiraClipCard job={clip()} isActive onResolve={vi.fn()} onDecided={vi.fn()} />,
    );
    expect(container.querySelector("video")?.getAttribute("src")).toBe("https://x/v.mp4");
    expect(screen.getByText(/awaiting review|in draft/i)).toBeInTheDocument();
    expect(screen.getByText(/UGC/i)).toBeInTheDocument();
  });

  it("active clip plays; inactive clip pauses", () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause");
    const { rerender } = render(
      <MiraClipCard job={clip()} isActive onResolve={vi.fn()} onDecided={vi.fn()} />,
    );
    expect(playSpy).toHaveBeenCalled();
    rerender(
      <MiraClipCard job={clip()} isActive={false} onResolve={vi.fn()} onDecided={vi.fn()} />,
    );
    expect(pauseSpy).toHaveBeenCalled();
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it("tapping the title navigates to detail", () => {
    render(<MiraClipCard job={clip()} isActive onResolve={vi.fn()} onDecided={vi.fn()} />);
    fireEvent.click(screen.getByText("Spring promo"));
    expect(push).toHaveBeenCalledWith("/mira/creatives/j1");
  });

  it("does not autoplay under prefers-reduced-motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    const play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.play = play;
    render(<MiraClipCard job={clip()} isActive onResolve={() => {}} onDecided={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(play).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
