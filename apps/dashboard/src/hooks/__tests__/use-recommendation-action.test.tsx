import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import { scopedKeys } from "@/lib/query-keys";
import { setEmitter } from "@/lib/feel-metrics";
import { useRecommendationAction } from "../use-recommendation-action";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1", principalId: "user-1" } }),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as never;

type ActionKey = "primary" | "secondary" | "dismiss" | "confirm" | "undo";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchMock.mockReset();
  setEmitter({ emit: () => {} }); // silence the default console.warn feel-metrics sink in tests
});
afterEach(() => setEmitter(null));

describe("useRecommendationAction", () => {
  it.each([["primary"], ["secondary"], ["dismiss"], ["confirm"], ["undo"]])(
    "calls POST with action=%s",
    async (action) => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ recommendation: {} }),
      });
      const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper });
      await act(async () => {
        const fn = result.current[action as ActionKey];
        await fn();
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/dashboard/recommendations",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(`"action":"${action}"`),
        }),
      );
    },
  );

  it("treats 409 as silent success (does not throw)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: "already_terminal" }),
    });
    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper });
    let threw = false;
    await act(async () => {
      try {
        await result.current.primary();
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
  });

  it("non-409 errors throw", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "boom" }),
    });
    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper });
    let threw: unknown = null;
    await act(async () => {
      try {
        await result.current.primary();
      } catch (e) {
        threw = e;
      }
    });
    expect(threw).toBeInstanceOf(Error);
  });

  it("includes note in body when provided", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ recommendation: {} }),
    });
    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper });
    await act(async () => {
      await result.current.primary("operator-note");
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('"note":"operator-note"');
  });
});

// ── Cache side-effects: the stale-feed fix ────────────────────────────────────

interface FeedShape {
  decisions: Array<{ sourceRef: { sourceId: string } }>;
  counts: { total: number; approval: number; handoff: number };
}

function feedDecision(sourceId: string, agentKey = "alex") {
  return {
    id: `dec-${sourceId}`,
    kind: "approval",
    agentKey,
    humanSummary: "x",
    presentation: { primaryLabel: "", secondaryLabel: "", dismissLabel: "", dataLines: [] },
    urgencyScore: 1,
    createdAt: new Date().toISOString(),
    threadHref: null,
    sourceRef: { kind: "approval", sourceId },
    meta: {},
  };
}

function seededClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const keys = scopedKeys("org-1");
  qc.setQueryData(keys.decisions.feed(null), {
    decisions: [feedDecision("r-1", "alex"), feedDecision("r-2", "riley")],
    counts: { total: 2, approval: 2, handoff: 0 },
  });
  // Also seed the Alex-filtered feed so the prefix-based removal AND rollback are
  // proven across more than one cached feed (decisions.all() matches both).
  qc.setQueryData(keys.decisions.feed("alex"), {
    decisions: [feedDecision("r-1", "alex")],
    counts: { total: 1, approval: 1, handoff: 0 },
  });
  return { qc, keys };
}

function qcWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function feedIds(qc: QueryClient, key: readonly unknown[]): string[] {
  const feed = qc.getQueryData<FeedShape>(key);
  return (feed?.decisions ?? []).map((d) => d.sourceRef.sourceId).sort();
}

describe("useRecommendationAction — stale-feed fix", () => {
  it("optimistically removes the acted decision from the feed before the server resolves", async () => {
    const { qc, keys } = seededClient();
    let resolveFetch!: () => void;
    fetchMock.mockReturnValueOnce(
      new Promise((res) => {
        resolveFetch = () =>
          res({ ok: true, status: 200, json: () => Promise.resolve({ recommendation: {} }) });
      }),
    );

    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper: qcWrapper(qc) });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.primary();
    });

    // The card leaves before the server answers (optimistic removal) — from BOTH
    // the unfiltered and the Alex-filtered feeds (prefix match).
    await waitFor(() => expect(feedIds(qc, keys.decisions.feed(null))).toEqual(["r-2"]));
    expect(feedIds(qc, keys.decisions.feed("alex"))).toEqual([]);

    resolveFetch();
    await act(async () => {
      await pending;
    });
  });

  it("rolls the optimistic removal back when the action fails", async () => {
    const { qc, keys } = seededClient();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "boom" }),
    });

    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper: qcWrapper(qc) });
    await act(async () => {
      try {
        await result.current.primary();
      } catch {
        /* expected */
      }
    });

    expect(feedIds(qc, keys.decisions.feed(null))).toEqual(["r-1", "r-2"]);
    expect(feedIds(qc, keys.decisions.feed("alex"))).toEqual(["r-1"]);
  });

  it("invalidates the decision feed on settle (kills the stale header-count desync)", async () => {
    const { qc, keys } = seededClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ recommendation: {} }),
    });

    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper: qcWrapper(qc) });
    await act(async () => {
      await result.current.primary();
    });

    const invalidated = invalidateSpy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey?: unknown })?.queryKey),
    );
    expect(invalidated).toContain(JSON.stringify(keys.decisions.all()));
  });

  it("does not optimistically remove on undo (undo restores the item)", async () => {
    const { qc, keys } = seededClient();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ recommendation: {} }),
    });

    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper: qcWrapper(qc) });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.undo();
    });
    // Undo must not drop the card optimistically.
    expect(feedIds(qc, keys.decisions.feed(null))).toEqual(["r-1", "r-2"]);
    await act(async () => {
      await pending;
    });
    // ...and it is still present after settlement (invalidation didn't corrupt it).
    expect(feedIds(qc, keys.decisions.feed(null))).toEqual(["r-1", "r-2"]);
  });

  it("emits approve_to_feedback_ms on settle", async () => {
    const sink = vi.fn();
    setEmitter({ emit: sink });
    const { qc } = seededClient();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ recommendation: {} }),
    });

    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper: qcWrapper(qc) });
    await act(async () => {
      await result.current.primary();
    });

    expect(sink).toHaveBeenCalledWith(
      "approve_to_feedback_ms",
      expect.objectContaining({
        latencyMs: expect.any(Number),
        decisionKind: "approval",
        agentKey: "alex",
      }),
    );
  });

  it("does not emit the approve-to-feedback latency metric on undo", async () => {
    const sink = vi.fn();
    setEmitter({ emit: sink });
    const { qc } = seededClient();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ recommendation: {} }),
    });

    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper: qcWrapper(qc) });
    await act(async () => {
      await result.current.undo();
    });

    // Undo is not an approve — it must not contaminate the latency distribution.
    expect(sink).not.toHaveBeenCalledWith("approve_to_feedback_ms", expect.anything());
  });
});
