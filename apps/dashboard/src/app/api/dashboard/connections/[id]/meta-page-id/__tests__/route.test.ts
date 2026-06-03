import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const setMetaPageId = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({ requireSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn().mockResolvedValue({ setMetaPageId }),
}));

import { PUT } from "../route";
import { requireSession } from "@/lib/session";

function mkReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/dashboard/connections/conn_1/meta-page-id", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: "conn_1" }) };

describe("PUT /api/dashboard/connections/:id/meta-page-id (proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMetaPageId.mockReset();
  });

  it("forwards { pageId } to client.setMetaPageId(id, pageId)", async () => {
    setMetaPageId.mockResolvedValueOnce({ connection: { id: "conn_1", updated: true } });
    const res = await PUT(mkReq({ pageId: "123456789012345" }), ctx);
    expect(setMetaPageId).toHaveBeenCalledWith("conn_1", "123456789012345");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connection: { id: "conn_1", updated: true } });
  });

  it("returns 401 on Unauthorized", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await PUT(mkReq({ pageId: "123456789012345" }), ctx);
    expect(res.status).toBe(401);
  });

  it("maps 'Connection not found' to 404", async () => {
    setMetaPageId.mockRejectedValueOnce(new Error("Connection not found"));
    const res = await PUT(mkReq({ pageId: "123456789012345" }), ctx);
    expect(res.status).toBe(404);
  });

  it("maps a validation error to 400 and surfaces the message", async () => {
    setMetaPageId.mockRejectedValueOnce(
      new Error("Facebook Page id must be the numeric Page ID (digits only)."),
    );
    const res = await PUT(mkReq({ pageId: "x" }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error.toLowerCase()).toContain("numeric");
  });

  it("maps 'Not a Meta Ads connection' to 400", async () => {
    setMetaPageId.mockRejectedValueOnce(new Error("Not a Meta Ads connection"));
    const res = await PUT(mkReq({ pageId: "123456789012345" }), ctx);
    expect(res.status).toBe(400);
  });

  it("maps a missing-org backend error to 403", async () => {
    setMetaPageId.mockRejectedValueOnce(new Error("Organization context required"));
    const res = await PUT(mkReq({ pageId: "123456789012345" }), ctx);
    expect(res.status).toBe(403);
  });

  it("maps a credential-encryption config error to 503", async () => {
    setMetaPageId.mockRejectedValueOnce(
      new Error(
        "Credential encryption is not configured. Set CREDENTIALS_ENCRYPTION_KEY environment variable.",
      ),
    );
    const res = await PUT(mkReq({ pageId: "123456789012345" }), ctx);
    expect(res.status).toBe(503);
  });
});
