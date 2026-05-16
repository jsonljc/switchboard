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

describe("contacts dashboard proxy", () => {
  it("returns 401 when no session", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await GET(mkRequest("https://x/api/dashboard/contacts"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with the upstream body on happy path", async () => {
    const fixture = {
      rows: [
        {
          id: "c-1",
          displayName: "Lisa K.",
          stage: "active",
          primaryChannel: "whatsapp",
          source: null,
          lastActivityAt: "2026-05-09T10:00:00.000Z",
          firstContactAt: "2026-05-01T10:00:00.000Z",
          opportunityCount: 0,
          detailHref: "/contacts/c-1",
        },
      ],
      nextCursor: null,
      hasMore: false,
    };
    const getContacts = vi.fn().mockResolvedValue(fixture);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getContacts });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(mkRequest("https://x/api/dashboard/contacts"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(fixture);
    expect(getContacts).toHaveBeenCalledTimes(1);
  });

  it("threads stage / search / cursor / limit / sort / direction through to the api client", async () => {
    const getContacts = vi.fn().mockResolvedValue({ rows: [], nextCursor: null, hasMore: false });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getContacts });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await GET(
      mkRequest(
        "https://x/api/dashboard/contacts?stage=active&search=lisa&cursor=abc&limit=25&sort=firstContactAt&direction=asc",
      ),
    );
    expect(getContacts).toHaveBeenCalledWith({
      stage: "active",
      search: "lisa",
      cursor: "abc",
      limit: 25,
      sort: "firstContactAt",
      direction: "asc",
    });
  });

  it("omits absent params (does not pass empty strings)", async () => {
    const getContacts = vi.fn().mockResolvedValue({ rows: [], nextCursor: null, hasMore: false });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getContacts });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await GET(mkRequest("https://x/api/dashboard/contacts"));
    expect(getContacts).toHaveBeenCalledWith({
      stage: undefined,
      search: undefined,
      cursor: undefined,
      limit: undefined,
      sort: undefined,
      direction: undefined,
    });
  });

  it("scopes to the user's org via getApiClient (which uses session-derived API key)", async () => {
    // The proxy enforces org scope through `getApiClient()` — same pattern as
    // decisions/route.ts. This test verifies we always call through the helper
    // rather than hitting upstream directly.
    const getContacts = vi.fn().mockResolvedValue({ rows: [], nextCursor: null, hasMore: false });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getContacts });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await GET(mkRequest("https://x/api/dashboard/contacts"));
    expect(getApiClient).toHaveBeenCalled();
    expect(requireSession).toHaveBeenCalled();
  });
});
