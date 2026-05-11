import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContactsListResponse } from "@switchboard/schemas";
import { useContactsList } from "../use-contacts-list";
import { CONTACTS_FIXTURE_PAGE } from "../../fixtures";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    contacts: { list: (q: object) => ["org-test", "contacts", "list", q] as const },
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

describe("useContactsList (D1b)", () => {
  const originalEnv = process.env.NEXT_PUBLIC_CONTACTS_LIVE;

  beforeEach(() => {
    delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_CONTACTS_LIVE;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_CONTACTS_LIVE;
    } else {
      process.env.NEXT_PUBLIC_CONTACTS_LIVE = originalEnv;
    }
  });

  describe("fixtures branch (NEXT_PUBLIC_CONTACTS_LIVE !== 'true')", () => {
    it("returns the fixture page without hitting the network", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { result } = renderHook(() => useContactsList({}), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.error).toBeNull();
      const pages = result.current.data?.pages ?? [];
      expect(pages).toHaveLength(1);
      expect(pages[0]).toEqual(CONTACTS_FIXTURE_PAGE);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("never sets hasNextPage on the fixture branch", async () => {
      const { result } = renderHook(() => useContactsList({}), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.hasNextPage).toBe(false);
    });
  });

  describe("live branch (NEXT_PUBLIC_CONTACTS_LIVE === 'true')", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_CONTACTS_LIVE = "true";
    });

    it("calls /api/dashboard/contacts and returns the response", async () => {
      const response: ContactsListResponse = {
        rows: [
          {
            id: "c-1",
            displayName: "Lisa K.",
            stage: "active",
            primaryChannel: "whatsapp",
            source: null,
            lastActivityAt: "2026-05-09T12:00:00.000Z",
            firstContactAt: "2026-05-01T00:00:00.000Z",
            opportunityCount: 1,
            detailHref: "/contacts/c-1",
          },
        ],
        nextCursor: null,
        hasMore: false,
      };
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const { result } = renderHook(() => useContactsList({}), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "");
      expect(calledUrl).toContain("/api/dashboard/contacts");
      expect(result.current.data?.pages?.[0]).toEqual(response);
    });

    it("threads stage and search into the querystring", async () => {
      const response: ContactsListResponse = { rows: [], nextCursor: null, hasMore: false };
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

      const { result } = renderHook(() => useContactsList({ stage: "active", search: "lisa" }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "");
      expect(calledUrl).toContain("stage=active");
      expect(calledUrl).toContain("search=lisa");
      expect(calledUrl).not.toContain("cursor=");
    });

    it("appends cursor on subsequent pages via fetchNextPage", async () => {
      const page1: ContactsListResponse = {
        rows: [],
        nextCursor: "Y3Vyc29yLTE=",
        hasMore: true,
      };
      const page2: ContactsListResponse = { rows: [], nextCursor: null, hasMore: false };
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));

      const { result } = renderHook(() => useContactsList({}), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.hasNextPage).toBe(true);

      await result.current.fetchNextPage();
      await waitFor(() => expect(result.current.data?.pages.length).toBe(2));

      const secondUrl = String(fetchSpy.mock.calls[1]?.[0] ?? "");
      expect(secondUrl).toContain("cursor=Y3Vyc29yLTE%3D");
    });

    it("surfaces non-2xx as an error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("oops", { status: 500 }));

      const { result } = renderHook(() => useContactsList({}), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });
});
