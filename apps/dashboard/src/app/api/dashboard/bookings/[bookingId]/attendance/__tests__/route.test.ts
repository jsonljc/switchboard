import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(),
}));

const mockRecordAttendance = vi.fn();
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(() => ({
    recordAttendance: mockRecordAttendance,
  })),
}));

// Mock idempotency so we get a predictable fallback key in tests
vi.mock("@/lib/idempotency", () => ({
  createIdempotencyKey: vi.fn(() => "minted-fallback-key"),
}));

import type { NextRequest } from "next/server";
import { POST } from "../route";
import { requireSession } from "@/lib/session";

const session = {
  user: { id: "u-1", email: "owner@example.com" },
  organizationId: "org-1",
  principalId: "p-1",
};

function makeRequest(bookingId: string, body: object, idempotencyKey?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return new Request(`http://localhost/api/dashboard/bookings/${bookingId}/attendance`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/dashboard/bookings/:bookingId/attendance (proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue(session);
    mockRecordAttendance.mockResolvedValue({ ok: true });
  });

  it("calls client.recordAttendance with SESSION org (not client-supplied), bookingId, body, and forwarded Idempotency-Key", async () => {
    const res = await POST(makeRequest("bk-42", { outcome: "attended" }, "client-key-xyz"), {
      params: Promise.resolve({ bookingId: "bk-42" }),
    });

    expect(res.status).toBe(200);
    expect(mockRecordAttendance).toHaveBeenCalledWith(
      "org-1", // from session, NOT from request body
      "bk-42", // from route params
      { outcome: "attended" },
      "client-key-xyz", // forwarded from request header
    );
  });

  it("mints a fallback Idempotency-Key when none is in the request headers", async () => {
    const res = await POST(makeRequest("bk-43", { outcome: "no_show" }), {
      params: Promise.resolve({ bookingId: "bk-43" }),
    });

    expect(res.status).toBe(200);
    expect(mockRecordAttendance).toHaveBeenCalledWith(
      "org-1",
      "bk-43",
      { outcome: "no_show" },
      "minted-fallback-key",
    );
  });

  it("returns 200 with the upstream body on success", async () => {
    mockRecordAttendance.mockResolvedValue({ bookingId: "bk-42", attendanceStatus: "attended" });

    const res = await POST(makeRequest("bk-42", { outcome: "attended" }, "k-1"), {
      params: Promise.resolve({ bookingId: "bk-42" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ bookingId: "bk-42", attendanceStatus: "attended" });
  });

  it("returns 401 via proxyError when session throws Unauthorized", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Unauthorized"));

    const res = await POST(makeRequest("bk-42", { outcome: "attended" }), {
      params: Promise.resolve({ bookingId: "bk-42" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 500 via proxyError on upstream API error", async () => {
    mockRecordAttendance.mockRejectedValue(new Error("API error: 500"));

    const res = await POST(makeRequest("bk-42", { outcome: "attended" }), {
      params: Promise.resolve({ bookingId: "bk-42" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("API error: 500");
  });
});
