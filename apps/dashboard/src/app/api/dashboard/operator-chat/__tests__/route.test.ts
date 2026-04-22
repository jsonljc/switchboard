import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock session before importing route
vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(),
}));

// Mock getApiClient
const mockSendOperatorCommand = vi.fn();
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(() => ({
    sendOperatorCommand: mockSendOperatorCommand,
  })),
}));

import { POST } from "../route";
import { requireSession } from "@/lib/session";

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
    mockSendOperatorCommand.mockResolvedValue({
      commandId: "cmd-1",
      status: "completed",
      message: "Done",
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

  it("returns error status on failure", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u-1", email: "owner@example.com" },
      organizationId: "org-1",
      principalId: "p-1",
    });
    mockSendOperatorCommand.mockRejectedValue(new Error("API error: 500"));

    const request = new Request("http://localhost/api/dashboard/operator-chat", {
      method: "POST",
      body: JSON.stringify({ rawInput: "show pipeline" }),
    });

    const res = await POST(request);
    expect(res.status).toBe(500);
  });
});
