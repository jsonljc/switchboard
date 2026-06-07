import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));

const mockGetPaidVisitsByCampaign = vi.fn();
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(() => ({ getPaidVisitsByCampaign: mockGetPaidVisitsByCampaign })),
}));

import { GET } from "../route";
import { requireSession } from "@/lib/session";

describe("GET /api/dashboard/revenue/paid-visits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Unauthorized"));
    const req = new Request("http://localhost/api/dashboard/revenue/paid-visits");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("proxies to the API with session org and returns rows", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u-1", email: "owner@example.com" },
      organizationId: "org-1",
      principalId: "p-1",
    });
    mockGetPaidVisitsByCampaign.mockResolvedValue({
      paidVisits: [
        {
          bookingId: "bk-1",
          amountMajor: 500,
          currency: "SGD",
          campaignId: "camp-1",
          campaignName: "camp-1",
          attributionBasis: "ctwa_captured",
          paidAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    });

    const req = new Request("http://localhost/api/dashboard/revenue/paid-visits");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paidVisits: unknown[] };
    expect(body.paidVisits).toHaveLength(1);
    // orgId comes from the session, not the request URL
    expect(mockGetPaidVisitsByCampaign).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
    );
  });

  it("maps THIS WEEK window to ~7 days", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      organizationId: "org-1",
    });
    mockGetPaidVisitsByCampaign.mockResolvedValue({ paidVisits: [] });
    const req = new Request(
      "http://localhost/api/dashboard/revenue/paid-visits?window=THIS%20WEEK",
    );
    await GET(req);
    const [, { from, to }] = (mockGetPaidVisitsByCampaign as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, { from: string; to: string }];
    const windowMs = new Date(to).getTime() - new Date(from).getTime();
    expect(windowMs).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3);
  });

  it("maps THIS MONTH window to ~30 days", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      organizationId: "org-1",
    });
    mockGetPaidVisitsByCampaign.mockResolvedValue({ paidVisits: [] });
    const req = new Request(
      "http://localhost/api/dashboard/revenue/paid-visits?window=THIS%20MONTH",
    );
    await GET(req);
    const [, { from, to }] = (mockGetPaidVisitsByCampaign as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, { from: string; to: string }];
    const windowMs = new Date(to).getTime() - new Date(from).getTime();
    expect(windowMs).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -3);
  });

  it("maps THIS QUARTER window to ~90 days", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      organizationId: "org-1",
    });
    mockGetPaidVisitsByCampaign.mockResolvedValue({ paidVisits: [] });
    const req = new Request(
      "http://localhost/api/dashboard/revenue/paid-visits?window=THIS%20QUARTER",
    );
    await GET(req);
    const [, { from, to }] = (mockGetPaidVisitsByCampaign as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, { from: string; to: string }];
    const windowMs = new Date(to).getTime() - new Date(from).getTime();
    expect(windowMs).toBeCloseTo(90 * 24 * 60 * 60 * 1000, -3);
  });

  it("falls back to 90-day range for unknown window", async () => {
    (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      organizationId: "org-1",
    });
    mockGetPaidVisitsByCampaign.mockResolvedValue({ paidVisits: [] });
    const req = new Request("http://localhost/api/dashboard/revenue/paid-visits");
    await GET(req);
    const [, { from, to }] = (mockGetPaidVisitsByCampaign as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, { from: string; to: string }];
    const windowMs = new Date(to).getTime() - new Date(from).getTime();
    expect(windowMs).toBeCloseTo(90 * 24 * 60 * 60 * 1000, -3);
  });
});
