import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/get-api-client", () => ({ getApiClient: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireSession: vi.fn().mockResolvedValue(undefined),
}));

import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { GET } from "../route";
import { goodFixture } from "@/app/(auth)/(mercury)/reports/fixtures";

function mkRequest(url: string) {
  const u = new URL(url);
  return { nextUrl: u } as unknown as Parameters<typeof GET>[0];
}

describe("reports dashboard proxy — GET", () => {
  it("forwards window to client.getReport and returns the payload", async () => {
    const getReport = vi.fn().mockResolvedValue(goodFixture);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getReport });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(mkRequest("http://test/api/dashboard/reports?window=THIS+MONTH"));

    expect(getReport).toHaveBeenCalledWith("THIS MONTH");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(goodFixture);
  });

  it("returns 400 when window param is missing", async () => {
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getReport: vi.fn(),
    });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(mkRequest("http://test/api/dashboard/reports"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/window/i) });
  });

  it("returns 400 when window value is not in the allowed set", async () => {
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getReport: vi.fn(),
    });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(mkRequest("http://test/api/dashboard/reports?window=YESTERDAY"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when session is missing", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getReport: vi.fn(),
    });

    const res = await GET(mkRequest("http://test/api/dashboard/reports?window=THIS+MONTH"));
    expect(res.status).toBe(401);
  });

  it("returns 500 surfacing the upstream error message on backend failure", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getReport: vi.fn().mockRejectedValue(new Error("Report dependencies not available")),
    });

    const res = await GET(mkRequest("http://test/api/dashboard/reports?window=THIS+MONTH"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: "Report dependencies not available",
    });
  });
});
