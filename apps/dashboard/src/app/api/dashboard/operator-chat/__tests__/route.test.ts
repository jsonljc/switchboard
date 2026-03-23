import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock session before importing route
vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(),
}));

import { POST } from "../route";
import { requireSession } from "@/lib/session";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("POST /api/dashboard/operator-chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Unauthorized"));

    const request = new Request("http://localhost/api/dashboard/operator-chat", {
      method: "POST",
      body: JSON.stringify({ rawInput: "show pipeline" }),
    });

    const res = await POST(request);
    expect(res.status).toBe(401);
  });

  it("proxies command to API and returns response", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u-1", email: "owner@example.com" },
      organizationId: "org-1",
      principalId: "p-1",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ commandId: "cmd-1", status: "completed", message: "Done" }),
    });

    const request = new Request("http://localhost/api/dashboard/operator-chat", {
      method: "POST",
      body: JSON.stringify({ rawInput: "show pipeline", channel: "dashboard" }),
    });

    const res = await POST(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commandId).toBe("cmd-1");
  });

  it("returns API error status on failure", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u-1", email: "owner@example.com" },
      organizationId: "org-1",
      principalId: "p-1",
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal server error"),
    });

    const request = new Request("http://localhost/api/dashboard/operator-chat", {
      method: "POST",
      body: JSON.stringify({ rawInput: "show pipeline" }),
    });

    const res = await POST(request);
    expect(res.status).toBe(500);
  });
});
