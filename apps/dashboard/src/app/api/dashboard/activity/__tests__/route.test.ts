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
  // Minimal NextRequest stand-in — the proxy only reads `nextUrl.searchParams`.
  const u = new URL(url);
  return { nextUrl: u } as unknown as Parameters<typeof GET>[0];
}

const FIXTURE = {
  rows: [],
  nextCursor: null,
  scope: "operational" as const,
  appliedFilters: {
    eventType: null,
    actorType: null,
    entityType: null,
    entityId: null,
    after: null,
    before: null,
  },
};

describe("activity dashboard proxy", () => {
  it("forwards query string params to the api client", async () => {
    const getActivity = vi.fn().mockResolvedValue(FIXTURE);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getActivity });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await GET(
      mkRequest(
        "https://x/api/dashboard/activity?scope=all&cursor=abc&limit=25&eventType=action.executed&actorType=agent&entityType=campaign&entityId=c-1&after=2026-01-01T00:00:00.000Z&before=2026-12-31T00:00:00.000Z",
      ),
    );

    expect(getActivity).toHaveBeenCalledWith({
      scope: "all",
      cursor: "abc",
      limit: 25,
      eventType: "action.executed",
      actorType: "agent",
      entityType: "campaign",
      entityId: "c-1",
      after: "2026-01-01T00:00:00.000Z",
      before: "2026-12-31T00:00:00.000Z",
    });
  });

  it("propagates non-200 upstream response as { error }", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await GET(mkRequest("https://x/api/dashboard/activity"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("enforces auth via getApiClient — always calls requireSession", async () => {
    const getActivity = vi.fn().mockResolvedValue(FIXTURE);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getActivity });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await GET(mkRequest("https://x/api/dashboard/activity"));

    expect(requireSession).toHaveBeenCalled();
    expect(getApiClient).toHaveBeenCalled();
  });
});
