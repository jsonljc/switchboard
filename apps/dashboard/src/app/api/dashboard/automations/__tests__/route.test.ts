import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireSession: vi.fn().mockResolvedValue(undefined),
}));

import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { GET } from "../route";

function mkRequest(url: string) {
  const u = new URL(url);
  return { nextUrl: u } as unknown as Parameters<typeof GET>[0];
}

describe("automations dashboard proxy", () => {
  it("returns 401 when no session", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await GET(mkRequest("https://x/api/dashboard/automations"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with the upstream body on happy path", async () => {
    const fixture = {
      rows: [],
      statusCounts: { all: 0, active: 0, fired: 0, cancelled: 0, expired: 0 },
      nextCursor: null,
      hasMore: false,
    };
    const getAutomations = vi.fn().mockResolvedValue(fixture);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getAutomations });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(mkRequest("https://x/api/dashboard/automations"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(fixture);
    expect(getAutomations).toHaveBeenCalledTimes(1);
  });

  it("threads status / cursor / limit / sort / direction through to the api client", async () => {
    const getAutomations = vi.fn().mockResolvedValue({
      rows: [],
      statusCounts: { all: 0, active: 0, fired: 0, cancelled: 0, expired: 0 },
      nextCursor: null,
      hasMore: false,
    });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getAutomations });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await GET(
      mkRequest(
        "https://x/api/dashboard/automations?status=active&cursor=abc&limit=25&sort=createdAt&direction=desc",
      ),
    );
    expect(getAutomations).toHaveBeenCalledWith({
      status: "active",
      cursor: "abc",
      limit: 25,
      sort: "createdAt",
      direction: "desc",
    });
  });

  it("omits absent params (does not pass empty strings)", async () => {
    const getAutomations = vi.fn().mockResolvedValue({
      rows: [],
      statusCounts: { all: 0, active: 0, fired: 0, cancelled: 0, expired: 0 },
      nextCursor: null,
      hasMore: false,
    });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getAutomations });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await GET(mkRequest("https://x/api/dashboard/automations"));
    expect(getAutomations).toHaveBeenCalledWith({
      status: undefined,
      cursor: undefined,
      limit: undefined,
      sort: undefined,
      direction: undefined,
    });
  });
});
