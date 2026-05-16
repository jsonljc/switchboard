import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwitchboardDashboardClient } from "../dashboard";
// Reuse production-shaped fixtures so this test never teaches a fake
// ReportDataV1 contract. `goodFixture` = THIS MONTH, `quietFixture` = THIS WEEK
// (per FIXTURES_BY_WINDOW). Mixing them keeps each test honest about which
// window it's exercising.
import { goodFixture, quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SwitchboardDashboardClient.getReport", () => {
  it("GETs /api/dashboard/reports with the window param URL-encoded", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => goodFixture,
    });

    const client = new SwitchboardDashboardClient("http://api.test", "key-123");
    const out = await client.getReport("THIS MONTH");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/dashboard/reports?window=THIS+MONTH");
    expect(init).toMatchObject({
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer key-123",
      },
    });
    expect(out).toEqual(goodFixture);
  });

  it("propagates upstream error body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: "Report dependencies not available" }),
    });

    const client = new SwitchboardDashboardClient("http://api.test", "key-123");

    await expect(client.getReport("THIS MONTH")).rejects.toThrow(
      "Report dependencies not available",
    );
  });
});

describe("SwitchboardDashboardClient.refreshReport", () => {
  it("POSTs /api/dashboard/reports/refresh and returns the recomputed payload", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => quietFixture,
    });

    const client = new SwitchboardDashboardClient("http://api.test", "key-123");
    const out = await client.refreshReport("THIS WEEK");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/dashboard/reports/refresh?window=THIS+WEEK");
    expect(init).toMatchObject({ method: "POST" });
    expect(out).toEqual(quietFixture);
  });
});
