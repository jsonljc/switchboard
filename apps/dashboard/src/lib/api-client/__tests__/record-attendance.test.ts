import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwitchboardDashboardClient } from "../dashboard";

const fetchMock = vi.fn();
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^idemp_\d+_[a-z0-9]+$/i;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SwitchboardDashboardClient.recordAttendance", () => {
  it("POSTs to /api/:orgId/bookings/:bookingId/attendance with correct url and body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const client = new SwitchboardDashboardClient("http://api.test", "key-abc");
    await client.recordAttendance("org-1", "bk-99", { outcome: "attended" }, "idemp-key-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/api/org-1/bookings/bk-99/attendance");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("idemp-key-1");
    expect(headers["Authorization"]).toBe("Bearer key-abc");
    expect(JSON.parse(init.body as string)).toEqual({ outcome: "attended" });
  });

  it("sends no_show outcome correctly", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const client = new SwitchboardDashboardClient("http://api.test", "key-abc");
    await client.recordAttendance(
      "org-1",
      "bk-100",
      { outcome: "no_show", recordedBy: "staff" },
      "idemp-key-2",
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/api/org-1/bookings/bk-100/attendance");
    expect(JSON.parse(init.body as string)).toEqual({ outcome: "no_show", recordedBy: "staff" });
  });

  it("sends a UUID-shaped Idempotency-Key when passed from createIdempotencyKey()", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    // Simulates what the proxy route does: pass a freshly minted key
    const key = `idemp_${Date.now()}_abc123`;
    const client = new SwitchboardDashboardClient("http://api.test", "key-abc");
    await client.recordAttendance("org-1", "bk-101", { outcome: "attended" }, key);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(UUID_RE);
  });

  it("propagates upstream error", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "missing_idempotency_key" }),
    });

    const client = new SwitchboardDashboardClient("http://api.test", "key-abc");
    await expect(
      client.recordAttendance("org-1", "bk-99", { outcome: "attended" }, "k"),
    ).rejects.toThrow("missing_idempotency_key");
  });
});
