import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MiraCreativeJobSummary } from "@switchboard/core";

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

const feed = vi.fn();
vi.mock("@/hooks/use-mira-feed", () => ({ useMiraFeed: () => feed() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, toggleHalt: vi.fn() }),
}));
vi.mock("@/hooks/use-creative-pipeline", () => ({
  useApproveStage: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCostEstimate: () => ({ data: null }),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "loading" }) }));
vi.mock("@/hooks/use-query-keys", () => ({ useScopedQueryKeys: () => null }));

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

  it("error → retry card", () => {
    feed.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderFeed();
    expect(screen.getByText(/Couldn't load/i)).toBeInTheDocument();
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
});
