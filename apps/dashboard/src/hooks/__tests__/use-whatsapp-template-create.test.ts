import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { useCreateWhatsAppTemplate } from "../use-whatsapp-template-create";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({ whatsappManagement: { templates: () => ["wa", "templates"] } }),
}));

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
};

const body = {
  name: "order_update",
  language: "en_US",
  category: "MARKETING" as const,
  body: { text: "Hello." },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useCreateWhatsAppTemplate", () => {
  it("posts to the create endpoint and resolves the result", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "1", status: "PENDING", category: "MARKETING" }), {
        status: 200,
      }),
    );
    const { result } = renderHook(() => useCreateWhatsAppTemplate(), { wrapper: wrapper() });
    result.current.mutate(body);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/whatsapp/templates",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.data).toMatchObject({ id: "1", status: "PENDING" });
  });

  it("throws the server error message on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "WHATSAPP_TEMPLATE_INVALID", message: "bad name", retryable: false },
        }),
        {
          status: 400,
        },
      ),
    );
    const { result } = renderHook(() => useCreateWhatsAppTemplate(), { wrapper: wrapper() });
    result.current.mutate(body);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("bad name");
  });
});
