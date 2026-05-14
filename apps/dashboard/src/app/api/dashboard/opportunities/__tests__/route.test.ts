import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn().mockResolvedValue({
    getOpportunitiesBoard: vi.fn().mockResolvedValue({ rows: [] }),
  }),
}));

import { GET } from "../route";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

describe("GET /api/dashboard/opportunities (proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards to client.getOpportunitiesBoard() and returns 200 JSON", async () => {
    const res = await GET();
    expect(requireSession).toHaveBeenCalledTimes(1);
    expect(getApiClient).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ rows: [] });
  });

  it("returns 401 when requireSession throws Unauthorized", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 500 for other errors", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Boom"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
