import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock session before importing route
vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(),
}));

// Mock getApiClient — both the throw-on-non-ok method (legacy) and the new
// raw passthrough used by the reply proxy must be mockable.
const mockReplyToEscalation = vi.fn();
const mockReplyToEscalationRaw = vi.fn();
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(() => ({
    replyToEscalation: mockReplyToEscalation,
    replyToEscalationRaw: mockReplyToEscalationRaw,
  })),
}));

import type { NextRequest } from "next/server";
import { POST } from "../route";
import { requireSession } from "@/lib/session";

const session = {
  user: { id: "u-1", email: "owner@example.com" },
  organizationId: "org-1",
  principalId: "p-1",
};

function makeRequest(id: string, message: string): NextRequest {
  // The route signature takes NextRequest, but at runtime only `await
  // request.json()` is called — a plain Request is structurally
  // compatible. Cast for test ergonomics; this is the same shortcut other
  // dashboard route tests use.
  return new Request(`http://localhost/api/dashboard/escalations/${id}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }) as unknown as NextRequest;
}

describe("POST /api/dashboard/escalations/:id/reply (proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue(session);
  });

  it("returns 200 and upstream body on upstream 200", async () => {
    mockReplyToEscalationRaw.mockResolvedValue({
      status: 200,
      body: {
        escalation: { id: "e-1", status: "released" },
        replySent: true,
      },
    });

    const res = await POST(makeRequest("e-1", "hello"), {
      params: Promise.resolve({ id: "e-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      escalation: { id: "e-1", status: "released" },
      replySent: true,
    });
    expect(mockReplyToEscalationRaw).toHaveBeenCalledWith("e-1", "hello");
  });

  it("passes through 502 with the upstream body shape intact", async () => {
    const upstreamBody = {
      escalation: { id: "e-1", status: "released" },
      replySent: false,
      error: "Reply saved but channel delivery failed. Retry or contact customer directly.",
      statusCode: 502,
    };
    mockReplyToEscalationRaw.mockResolvedValue({ status: 502, body: upstreamBody });

    const res = await POST(makeRequest("e-1", "hello"), {
      params: Promise.resolve({ id: "e-1" }),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual(upstreamBody);
  });

  it("returns 500 via proxyError on a thrown server error (non-502 non-ok)", async () => {
    mockReplyToEscalationRaw.mockRejectedValue(new Error("API error: 500"));

    const res = await POST(makeRequest("e-1", "hello"), {
      params: Promise.resolve({ id: "e-1" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("API error: 500");
  });

  it("returns 401 when not authenticated", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Unauthorized"));

    const res = await POST(makeRequest("e-1", "hello"), {
      params: Promise.resolve({ id: "e-1" }),
    });
    expect(res.status).toBe(401);
  });
});
