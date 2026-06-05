import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MiraCreativeJobSummary } from "@switchboard/core";
import type React from "react";
import type { ReactElement } from "react";
import type { ReviewDecisionResult } from "@/hooks/use-review-decision";

// ---------------------------------------------------------------------------
// Controllable IntersectionObserver — override BEFORE any component imports so
// the feed picks up this class instead of the no-op in test-setup.ts.
// ---------------------------------------------------------------------------
let ioInstances: Array<{ cb: IntersectionObserverCallback; els: Element[] }> = [];
beforeEach(() => {
  ioInstances = [];
});
class FakeIO {
  cb: IntersectionObserverCallback;
  els: Element[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    ioInstances.push(this);
  }
  observe(el: Element) {
    this.els.push(el);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
// @ts-expect-error override
global.IntersectionObserver = FakeIO;

// ---------------------------------------------------------------------------

const toastSpy = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

const feed = vi.fn();
vi.mock("@/hooks/use-mira-feed", () => ({ useMiraFeed: () => feed() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, toggleHalt: vi.fn() }),
}));
vi.mock("@/hooks/use-creative-pipeline", () => ({
  useApproveStage: () => ({
    mutate: vi.fn((_args: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()),
    isPending: false,
    isError: false,
  }),
  useCostEstimate: () => ({ data: null }),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "loading" }) }));
vi.mock("@/hooks/use-query-keys", () => ({ useScopedQueryKeys: () => null }));

// Controllable decide mock — tests can replace the mutate fn per-case.
let decideMutate = vi.fn();
vi.mock("@/hooks/use-review-decision", () => ({
  useReviewDecision: () => ({ mutate: decideMutate, isPending: false, isError: false }),
}));

import { MiraCreativeFeed } from "../mira-creative-feed";

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderFeed() {
  const qc = makeQc();
  return render(
    <QueryClientProvider client={qc}>
      <MiraCreativeFeed />
    </QueryClientProvider>,
  );
}

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

/** A draft_ready clip whose actions show Keep / Pass. */
function draftClip(id: string): MiraCreativeJobSummary {
  return {
    id,
    title: `Draft ${id}`,
    stage: "production",
    status: "draft_ready",
    draft: { videoUrl: `https://x/${id}.mp4` },
    reviewAction: { canContinue: false, canStop: false, label: "review_draft" },
    source: { engine: "legacy_creative_job", mode: "polished" },
    createdAt: "2026-05-27T00:00:00Z",
    updatedAt: "2026-05-27T00:00:00Z",
  };
}

describe("MiraCreativeFeed", () => {
  beforeEach(() => {
    toastSpy.mockClear();
    decideMutate = vi.fn();
  });

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
    renderFeed();
    expect(screen.getAllByTestId("mira-clip")).toHaveLength(2);
  });

  it("empty → honest empty state", () => {
    feed.mockReturnValue({
      data: { jobs: [], counts: {}, feed: { reviewableCount: 0, renderingCount: 0 } },
      isLoading: false,
      isError: false,
    });
    renderFeed();
    expect(screen.getByText(/No drafts to review yet/i)).toBeInTheDocument();
  });

  it("loading → skeleton, not empty copy", () => {
    feed.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderFeed();
    expect(screen.queryByText(/No drafts to review yet/i)).toBeNull();
    expect(screen.getByTestId("mira-feed-skeleton")).toBeInTheDocument();
  });

  it("error → ConnectionTrouble card with retry wiring", () => {
    const retrySpy = vi.fn();
    feed.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: retrySpy });
    renderFeed();
    // role=alert is the shared failure vocabulary from ConnectionTrouble
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // retry button is wired to refetch
    const retryBtn = screen.getByRole("button", { name: /try again/i });
    retryBtn.click();
    expect(retrySpy).toHaveBeenCalledOnce();
  });

  it("first clip active on mount, others paused", () => {
    feed.mockReturnValue({
      data: {
        jobs: [clip("a"), clip("b")],
        counts: {},
        feed: { reviewableCount: 2, renderingCount: 0 },
      },
      isLoading: false,
      isError: false,
    });
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause");

    renderFeed();

    // card0 (isActive=true) → play; card1 (isActive=false) → pause
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).toHaveBeenCalledTimes(1);

    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it("scrolling promotes the next clip", () => {
    feed.mockReturnValue({
      data: {
        jobs: [clip("a"), clip("b")],
        counts: {},
        feed: { reviewableCount: 2, renderingCount: 0 },
      },
      isLoading: false,
      isError: false,
    });
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause");

    const { container } = renderFeed();

    const playCountAfterMount = playSpy.mock.calls.length;
    const pauseCountAfterMount = pauseSpy.mock.calls.length;

    // Simulate IO firing for the second wrapper
    const wrapper1 = container.querySelector('[data-clip-index="1"]');
    expect(wrapper1).not.toBeNull();

    // There should be at least one IO instance registered by the feed
    expect(ioInstances.length).toBeGreaterThan(0);
    const io = ioInstances[0];

    act(() => {
      io.cb(
        [{ isIntersecting: true, target: wrapper1 } as unknown as IntersectionObserverEntry],
        io as unknown as IntersectionObserver,
      );
    });

    // After promoting card1: card1 plays, card0 pauses → net +1 play +1 pause vs mount
    expect(playSpy.mock.calls.length).toBeGreaterThan(playCountAfterMount);
    expect(pauseSpy.mock.calls.length).toBeGreaterThan(pauseCountAfterMount);

    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it("resolving a clip dismisses it from the feed", async () => {
    feed.mockReturnValue({
      data: {
        jobs: [clip("a"), clip("b")],
        counts: {},
        feed: { reviewableCount: 2, renderingCount: 0 },
      },
      isLoading: false,
      isError: false,
    });

    renderFeed();

    // Two clips on mount
    expect(screen.getAllByTestId("mira-clip")).toHaveLength(2);

    // Drive the first clip's rail: Continue → Confirm continue
    // The mock for useApproveStage calls opts.onSuccess() immediately,
    // which propagates onResolve("a") → handleResolve in the feed.
    const continueButtons = screen.getAllByRole("button", { name: /continue draft/i });
    await act(async () => {
      fireEvent.click(continueButtons[0]);
    });
    const confirmButtons = screen.getAllByRole("button", { name: /confirm continue/i });
    await act(async () => {
      fireEvent.click(confirmButtons[0]);
    });

    // First clip (id="a", title="Clip a") should be gone; only one clip remains
    expect(screen.getAllByTestId("mira-clip")).toHaveLength(1);
    expect(screen.queryByText("Clip a")).toBeNull();
    expect(screen.getByText("Clip b")).toBeInTheDocument();
  });

  it("keep raises an undo toast", async () => {
    feed.mockReturnValue({
      data: {
        jobs: [draftClip("d1")],
        counts: {},
        feed: { reviewableCount: 1, renderingCount: 0 },
      },
      isLoading: false,
      isError: false,
    });
    // Simulate decide.mutate calling its onSuccess with a non-silent result.
    decideMutate = vi.fn(
      (
        _args: unknown,
        opts?: { onSuccess?: (data: { id: string; decision: string; silent?: boolean }) => void },
      ) => opts?.onSuccess?.({ id: "d1", decision: "kept" }),
    );

    renderFeed();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^keep/i }));
    });

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy.mock.calls[0][0].title).toBe("Kept");
    expect(toastSpy.mock.calls[0][0].action).toBeTruthy();
  });

  it("a silent (409) decision dismisses without a toast", async () => {
    feed.mockReturnValue({
      data: {
        jobs: [draftClip("d2")],
        counts: {},
        feed: { reviewableCount: 1, renderingCount: 0 },
      },
      isLoading: false,
      isError: false,
    });
    // Simulate decide.mutate calling its onSuccess with silent: true (409 path).
    decideMutate = vi.fn(
      (
        _args: unknown,
        opts?: { onSuccess?: (data: { id: string; decision: string; silent?: boolean }) => void },
      ) => opts?.onSuccess?.({ id: "d2", decision: "passed", silent: true }),
    );

    renderFeed();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^pass/i }));
    });

    // Clip dismissed (resolved set removes it)
    await waitFor(() => expect(screen.queryByTestId("mira-clip")).not.toBeInTheDocument());
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("undo restores the clip", async () => {
    feed.mockReturnValue({
      data: {
        jobs: [draftClip("d3")],
        counts: {},
        feed: { reviewableCount: 1, renderingCount: 0 },
      },
      isLoading: false,
      isError: false,
    });
    // First call (keep): fires onSuccess immediately. Second call (undo): also fires onSuccess.
    decideMutate = vi
      .fn()
      .mockImplementationOnce(
        (_args: unknown, opts?: { onSuccess?: (data: ReviewDecisionResult) => void }) =>
          opts?.onSuccess?.({ id: "d3", decision: "kept" }),
      )
      .mockImplementationOnce(
        (_args: unknown, opts?: { onSuccess?: (data: ReviewDecisionResult) => void }) =>
          opts?.onSuccess?.({ id: "d3", decision: null }),
      );

    renderFeed();

    // Click Keep — clip is hidden and toast fires
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^keep/i }));
    });
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());

    // Invoke the Undo action from the toast payload
    const toastArg = toastSpy.mock.calls[0][0] as {
      title: string;
      action: ReactElement<{ onClick: () => void }>;
    };
    await act(async () => {
      toastArg.action.props.onClick();
    });

    // Clip should reappear
    await waitFor(() => expect(screen.getAllByTestId("mira-clip")).toHaveLength(1));
  });
});
