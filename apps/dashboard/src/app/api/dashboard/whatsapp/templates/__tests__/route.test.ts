import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/get-api-client", () => ({ getApiClient: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn().mockResolvedValue(undefined) }));

import { getApiClient } from "@/lib/get-api-client";
import { GET, POST } from "../route";

function mkPost(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

describe("whatsapp templates dashboard proxy", () => {
  it("GET forwards the listWhatsAppTemplates payload + status", async () => {
    const listWhatsAppTemplates = vi
      .fn()
      .mockResolvedValue({ status: 200, data: { templates: [{ name: "hello_world" }] } });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      listWhatsAppTemplates,
    });

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ templates: [{ name: "hello_world" }] });
  });

  it("POST forwards the body to createWhatsAppTemplate and relays status", async () => {
    const createWhatsAppTemplate = vi
      .fn()
      .mockResolvedValue({
        status: 200,
        data: { id: "1", status: "PENDING", category: "MARKETING" },
      });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      createWhatsAppTemplate,
    });
    const body = {
      name: "order_update",
      language: "en_US",
      category: "MARKETING",
      body: { text: "Hello." },
    };

    const res = await POST(mkPost(body));

    expect(createWhatsAppTemplate).toHaveBeenCalledWith(body);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ id: "1", status: "PENDING" });
  });

  it("POST relays a 400 validation error from the API (status + message preserved)", async () => {
    const createWhatsAppTemplate = vi.fn().mockResolvedValue({
      status: 400,
      data: { error: { code: "WHATSAPP_TEMPLATE_INVALID", message: "bad name", retryable: false } },
    });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      createWhatsAppTemplate,
    });

    const res = await POST(mkPost({}));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: { message: "bad name" } });
  });
});
