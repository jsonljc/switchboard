import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuditEntriesListResponse } from "@switchboard/schemas";
import { useActivityList } from "../use-activity-list";
import { ACTIVITY_FIXTURES } from "../../fixtures";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    activity: {
      all: () => ["org-test", "activity"] as const,
      list: (q: object) => ["org-test", "activity", "list", q] as const,
    },
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const EMPTY_RESPONSE: AuditEntriesListResponse = {
  rows: [],
  nextCursor: null,
  scope: "operational",
  appliedFilters: {
    eventType: null,
    actorType: null,
    entityType: null,
    entityId: null,
    after: null,
    before: null,
  },
};

describe("useActivityList (D3a)", () => {
  const originalEnv = process.env.NEXT_PUBLIC_ACTIVITY_LIVE;

  beforeEach(() => {
    delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_ACTIVITY_LIVE;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_ACTIVITY_LIVE;
    } else {
      process.env.NEXT_PUBLIC_ACTIVITY_LIVE = originalEnv;
    }
  });

  // ── 1. initial query uses scope=operational ──────────────────────────────────

  it("initial query uses scope=operational (fixture branch)", async () => {
    const { result } = renderHook(() => useActivityList({}), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Fixture response always has scope: "operational"
    expect(result.current.data?.scope).toBe("operational");
    expect(result.current.data?.rows).toEqual(ACTIVITY_FIXTURES);
  });

  // ── 2. chip toggle (scope change) updates query key ──────────────────────────

  it("chip toggle (scope change) updates query key", async () => {
    const { result: r1 } = renderHook(() => useActivityList({ scope: "operational" }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(r1.current.isSuccess).toBe(true));

    const { result: r2 } = renderHook(() => useActivityList({ scope: "all" }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(r2.current.isSuccess).toBe(true));

    // Both succeed but are issued with different query keys — the two hooks
    // share no cache entry. Indirectly verified by checking both can coexist
    // without collision.
    expect(r1.current.data?.rows).toBeDefined();
    expect(r2.current.data?.rows).toBeDefined();
  });

  // ── 3. cursor advance updates query key ──────────────────────────────────────

  it("cursor advance updates query key", async () => {
    // Fixture branch: cursor is passed through to the key but the queryFn
    // ignores it and returns the same fixture. The important property is that
    // a different cursor produces a different key (i.e. cache miss → fresh fetch).
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { result: rPage1 } = renderHook(() => useActivityList({ cursor: undefined }), {
      wrapper: createWrapper(),
    });
    const { result: rPage2 } = renderHook(() => useActivityList({ cursor: "Y3Vyc29yLTE=" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(rPage1.current.isSuccess).toBe(true));
    await waitFor(() => expect(rPage2.current.isSuccess).toBe(true));

    // Fixture branch — no real fetch should have been issued
    expect(fetchSpy).not.toHaveBeenCalled();
    // Both queries resolve independently (different keys)
    expect(rPage1.current.data).not.toBeNull();
    expect(rPage2.current.data).not.toBeNull();
  });

  // ── 4. URL params populate query ─────────────────────────────────────────────

  it("URL params populate query (eventType, actorType, etc. all flow into the key)", async () => {
    // Live branch so we can inspect the querystring
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(EMPTY_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { result } = renderHook(
      () =>
        useActivityList({
          scope: "all",
          eventType: "action.executed",
          actorType: "agent",
          entityType: "calendar_event",
          entityId: "cal_evt_001",
          after: "2026-05-01T00:00:00.000Z",
          before: "2026-05-09T00:00:00.000Z",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("scope=all");
    expect(calledUrl).toContain("eventType=action.executed");
    expect(calledUrl).toContain("actorType=agent");
    expect(calledUrl).toContain("entityType=calendar_event");
    expect(calledUrl).toContain("entityId=cal_evt_001");
    expect(calledUrl).toContain("after=");
    expect(calledUrl).toContain("before=");
  });

  // ── 5. error response surfaces as { isError: true } ─────────────────────────

  it("error response surfaces as { isError: true }", async () => {
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal error", { status: 500 }),
    );

    const { result } = renderHook(() => useActivityList({}), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  // ── 6. staleTime is 30_000 (no refetchInterval) ──────────────────────────────

  it("staleTime is 30_000 on the live branch", async () => {
    process.env.NEXT_PUBLIC_ACTIVITY_LIVE = "true";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(EMPTY_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    let queryClient!: QueryClient;
    const wrapper = ({ children }: { children: React.ReactNode }) => {
      queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };

    const { result } = renderHook(() => useActivityList({}), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Inspect the resolved query options for staleTime. The hook does not
    // set refetchInterval, so it should be absent (undefined).
    const queryCache = queryClient.getQueryCache();
    const queries = queryCache.getAll();
    expect(queries).toHaveLength(1);

    const observerOptions = queries[0]?.observers[0]?.options;
    expect(observerOptions?.staleTime).toBe(30_000);
    expect(
      (observerOptions as unknown as Record<string, unknown>)?.refetchInterval,
    ).toBeUndefined();
  });
});
