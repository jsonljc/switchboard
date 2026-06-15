import { describe, it, expect, vi, beforeEach } from "vitest";

const onboardWhatsAppEmbedded = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session", () => ({ requireSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn().mockResolvedValue({ onboardWhatsAppEmbedded }),
}));

import { POST } from "../route";
import { getApiClient } from "@/lib/get-api-client";

function mkReq(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/connections/whatsapp-embedded", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/dashboard/connections/whatsapp-embedded (authed proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onboardWhatsAppEmbedded.mockReset();
  });

  it("forwards the body via the AUTHED api client and relays status + data", async () => {
    onboardWhatsAppEmbedded.mockResolvedValueOnce({
      status: 200,
      data: { success: true, connectionId: "conn_1" },
    });

    const res = await POST(mkReq({ code: "C", wabaId: "W", phoneNumberId: "P" }));

    // The proxy MUST go through getApiClient (operator Bearer), not a raw fetch.
    expect(getApiClient).toHaveBeenCalledTimes(1);
    expect(onboardWhatsAppEmbedded).toHaveBeenCalledWith({
      code: "C",
      wabaId: "W",
      phoneNumberId: "P",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, connectionId: "conn_1" });
  });

  it("relays a non-2xx status from the API unchanged", async () => {
    onboardWhatsAppEmbedded.mockResolvedValueOnce({ status: 502, data: { error: "boom" } });
    const res = await POST(mkReq({ code: "C" }));
    expect(res.status).toBe(502);
  });

  it("maps an Unauthorized session to 401 (no unauthenticated forward)", async () => {
    vi.mocked(getApiClient).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await POST(mkReq({ code: "C" }));
    expect(res.status).toBe(401);
    expect(onboardWhatsAppEmbedded).not.toHaveBeenCalled();
  });
});
