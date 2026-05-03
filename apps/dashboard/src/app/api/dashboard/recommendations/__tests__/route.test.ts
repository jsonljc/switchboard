import { describe, expect, it, vi } from "vitest";

// Mock the helpers used by route.ts.
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(),
}));
vi.mock("@/lib/require-dashboard-session", () => ({
  requireDashboardSession: vi.fn().mockResolvedValue(undefined),
}));

import { getApiClient } from "@/lib/get-api-client";
import { GET, POST } from "../route.js";

describe("recommendations dashboard proxy", () => {
  it("GET forwards surface query param", async () => {
    const listRecommendations = vi.fn().mockResolvedValue({ recommendations: [] });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      listRecommendations,
    });
    const req = new Request("http://x/api/dashboard/recommendations?surface=queue");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    expect(listRecommendations).toHaveBeenCalledWith({
      surface: "queue",
      status: "pending",
      since: undefined,
    });
  });

  it("POST reshapes recommendationId and propagates 200", async () => {
    const actOnRecommendation = vi
      .fn()
      .mockResolvedValue({ status: 200, body: { recommendation: { id: "r-1", status: "acted" } } });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      actOnRecommendation,
    });
    const req = new Request("http://x/api/dashboard/recommendations", {
      method: "POST",
      body: JSON.stringify({ recommendationId: "r-1", action: "primary" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(actOnRecommendation).toHaveBeenCalledWith("r-1", { action: "primary" });
    const body = await res.json();
    expect(body.recommendation.status).toBe("acted");
  });

  it("POST propagates 409 status from upstream", async () => {
    const actOnRecommendation = vi.fn().mockResolvedValue({
      status: 409,
      body: { error: "already_terminal", recommendation: { id: "r-1", status: "acted" } },
    });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      actOnRecommendation,
    });
    const req = new Request("http://x/api/dashboard/recommendations", {
      method: "POST",
      body: JSON.stringify({ recommendationId: "r-1", action: "primary" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_terminal");
  });

  it("POST propagates 5xx from upstream", async () => {
    const actOnRecommendation = vi.fn().mockResolvedValue({ status: 500, body: { error: "boom" } });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      actOnRecommendation,
    });
    const req = new Request("http://x/api/dashboard/recommendations", {
      method: "POST",
      body: JSON.stringify({ recommendationId: "r-1", action: "primary" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(500);
  });
});
