import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock session before importing route
vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(),
}));

// Mock getApiClient — expose resumeRaw so the proxy can be exercised.
const mockResumeRaw = vi.fn();
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(() => ({
    resumeRaw: mockResumeRaw,
  })),
}));

import { POST } from "../route";
import { requireSession } from "@/lib/session";

const session = {
  user: { id: "u-1", email: "owner@example.com" },
  organizationId: "org-1",
  principalId: "p-1",
};

function makeRequest(body: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/dashboard/governance/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/dashboard/governance/resume (proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue(session);
  });

  it("returns 200 and upstream body on upstream 200", async () => {
    const upstreamBody = { resumed: true, profile: "balanced" };
    mockResumeRaw.mockResolvedValue({ status: 200, body: upstreamBody });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(upstreamBody);
    expect(mockResumeRaw).toHaveBeenCalledWith({});
  });

  it("forwards 400 with full readiness body intact (the fix)", async () => {
    const upstreamBody = {
      resumed: false,
      readiness: {
        ready: false,
        checks: [
          {
            id: "meta",
            label: "Meta Ads",
            status: "fail",
            message: "Not connected",
            blocking: true,
          },
        ],
      },
      statusCode: 400,
    };
    mockResumeRaw.mockResolvedValue({ status: 400, body: upstreamBody });

    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual(upstreamBody);
    // Verify the readiness checks structure is preserved verbatim
    expect(body.readiness.checks[0].status).toBe("fail");
    expect(body.readiness.checks[0].label).toBe("Meta Ads");
    expect(body.resumed).toBe(false);
  });

  it("returns 500 via proxyError on a thrown server error", async () => {
    mockResumeRaw.mockRejectedValue(new Error("API error: 500"));

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("API error: 500");
  });

  it("returns 401 when requireSession rejects with Unauthorized", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Unauthorized"));

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });
});
