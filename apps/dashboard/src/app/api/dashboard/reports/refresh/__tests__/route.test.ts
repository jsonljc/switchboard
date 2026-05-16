import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/get-api-client", () => ({ getApiClient: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireSession: vi.fn().mockResolvedValue(undefined),
}));

import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { POST } from "../route";
import { quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";

function mkRequest(url: string) {
  const u = new URL(url);
  return { nextUrl: u } as unknown as Parameters<typeof POST>[0];
}

describe("reports refresh dashboard proxy — POST", () => {
  it("forwards window to client.refreshReport and returns the recomputed payload", async () => {
    // quietFixture is the THIS WEEK fixture per FIXTURES_BY_WINDOW.
    const refreshReport = vi.fn().mockResolvedValue(quietFixture);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ refreshReport });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await POST(mkRequest("http://test/api/dashboard/reports/refresh?window=THIS+WEEK"));

    expect(refreshReport).toHaveBeenCalledWith("THIS WEEK");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(quietFixture);
  });

  it("returns 400 when window param is missing or invalid", async () => {
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      refreshReport: vi.fn(),
    });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const r1 = await POST(mkRequest("http://test/api/dashboard/reports/refresh"));
    const r2 = await POST(mkRequest("http://test/api/dashboard/reports/refresh?window=YESTERDAY"));
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
  });

  it("returns 401 when session is missing", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      refreshReport: vi.fn(),
    });

    const res = await POST(
      mkRequest("http://test/api/dashboard/reports/refresh?window=THIS+MONTH"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 500 surfacing the upstream error message on backend failure", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      refreshReport: vi.fn().mockRejectedValue(new Error("Report dependencies not available")),
    });

    const res = await POST(
      mkRequest("http://test/api/dashboard/reports/refresh?window=THIS+MONTH"),
    );
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: "Report dependencies not available",
    });
  });
});
