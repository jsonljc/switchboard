import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContactDetailResponse } from "@switchboard/schemas";

const { notFoundFn } = vi.hoisted(() => {
  const notFoundFn = vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  return { notFoundFn };
});

vi.mock("next/navigation", () => ({ notFound: notFoundFn }));

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    contacts: {
      list: (q: object) => ["org-test", "contacts", "list", q] as const,
      detail: (id: string) => ["org-test", "contacts", "detail", id] as const,
    },
  }),
}));

import { useContactDetail } from "../use-contact-detail";
import { CONTACT_DETAIL_FIXTURES } from "../../fixtures";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useContactDetail (D1.5)", () => {
  const originalEnv = process.env.NEXT_PUBLIC_CONTACTS_LIVE;

  beforeEach(() => {
    delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_CONTACTS_LIVE;
    notFoundFn.mockClear();
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
    it("returns the matching fixture synchronously without hitting the network", () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { result } = renderHook(() => useContactDetail("fx-lisa"), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isError).toBe(false);
      expect(result.current.data).toEqual(CONTACT_DETAIL_FIXTURES["fx-lisa"]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(notFoundFn).not.toHaveBeenCalled();
    });

    it("calls notFound() when the fixture id is unknown", () => {
      expect(() =>
        renderHook(() => useContactDetail("does-not-exist"), {
          wrapper: createWrapper(),
        }),
      ).toThrow("NEXT_NOT_FOUND");
      // React strict-mode double-invokes the render; once is enough for us.
      expect(notFoundFn).toHaveBeenCalled();
    });
  });

  describe("live branch (NEXT_PUBLIC_CONTACTS_LIVE === 'true')", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_CONTACTS_LIVE = "true";
    });

    it("fetches /api/dashboard/contacts/:id and returns the parsed response", async () => {
      const response: ContactDetailResponse = CONTACT_DETAIL_FIXTURES["fx-lisa"]!;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const { result } = renderHook(() => useContactDetail("fx-lisa"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.data).toBeDefined());

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "");
      expect(calledUrl).toBe("/api/dashboard/contacts/fx-lisa");
      expect(result.current.data).toEqual(response);
    });

    it("encodes the id segment", async () => {
      const response: ContactDetailResponse = CONTACT_DETAIL_FIXTURES["fx-lisa"]!;
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

      const { result } = renderHook(() => useContactDetail("a/b c"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.data).toBeDefined());

      const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "");
      expect(calledUrl).toBe("/api/dashboard/contacts/a%2Fb%20c");
    });

    it("calls notFound() on a 404 response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));

      const { result } = renderHook(() => useContactDetail("missing"), {
        wrapper: createWrapper(),
      });

      // notFound() throws inside queryFn; React Query surfaces it as isError.
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(notFoundFn).toHaveBeenCalled();
    });

    it("surfaces non-2xx (e.g. 500) as an error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("oops", { status: 500 }));

      const { result } = renderHook(() => useContactDetail("fx-lisa"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(Error);
      expect(notFoundFn).not.toHaveBeenCalled();
    });

    it("uses keys.contacts.detail(id) as the query key", async () => {
      // Inspect QueryClient state by accessing the client through a nested hook.
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      const response: ContactDetailResponse = CONTACT_DETAIL_FIXTURES["fx-lisa"]!;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(response), { status: 200 }),
      );

      const { result } = renderHook(() => useContactDetail("fx-lisa"), { wrapper });
      await waitFor(() => expect(result.current.data).toBeDefined());

      const cached = queryClient.getQueryData(["org-test", "contacts", "detail", "fx-lisa"]);
      expect(cached).toEqual(response);
    });
  });
});
