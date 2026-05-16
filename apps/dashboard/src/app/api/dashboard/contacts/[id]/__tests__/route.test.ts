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

function mkRequest() {
  // Proxy never reads the request body — just satisfy the signature.
  return new Request("https://x/api/dashboard/contacts/c-1");
}

function mkParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const SAMPLE_DETAIL = {
  profile: {
    id: "c-1",
    displayName: "Lisa K.",
    primaryChannel: "whatsapp",
    stage: "active",
    phone: null,
    email: null,
    source: null,
    sourceType: null,
    attributionSummary: null,
    messagingConsent: { optedIn: false, optedInAt: null, source: null, optedOutAt: null },
    firstContactAt: "2026-05-01T10:00:00.000Z",
    lastActivityAt: "2026-05-09T10:00:00.000Z",
  },
  opportunities: [],
  threads: [],
  openDecisions: [],
  revenueEvents: [],
};

describe("contact detail dashboard proxy", () => {
  it("returns 401 when no session", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await GET(mkRequest(), mkParams("c-1"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with the upstream body on happy path", async () => {
    const getContact = vi.fn().mockResolvedValue(SAMPLE_DETAIL);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getContact });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(mkRequest(), mkParams("c-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(SAMPLE_DETAIL);
    expect(getContact).toHaveBeenCalledWith("c-1");
  });

  it("forwards the contactId param verbatim (including special characters)", async () => {
    const getContact = vi.fn().mockResolvedValue(SAMPLE_DETAIL);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getContact });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await GET(mkRequest(), mkParams("contact with space"));
    // The api-client is responsible for encoding; the proxy passes through raw.
    expect(getContact).toHaveBeenCalledWith("contact with space");
  });

  it("returns 404 when upstream returns 404 (CONTACT_NOT_FOUND)", async () => {
    // Mirror what api-client.getContact does on a 404 from the API.
    const notFound = Object.assign(new Error("CONTACT_NOT_FOUND"), { status: 404 });
    const getContact = vi.fn().mockRejectedValue(notFound);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getContact });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(mkRequest(), mkParams("missing"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("CONTACT_NOT_FOUND");
  });

  it("returns 500 for other upstream errors", async () => {
    const boom = Object.assign(new Error("kaboom"), { status: 500 });
    const getContact = vi.fn().mockRejectedValue(boom);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getContact });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(mkRequest(), mkParams("c-1"));
    expect(res.status).toBe(500);
  });

  it("scopes to the user's org via getApiClient (session-bound API key)", async () => {
    const getContact = vi.fn().mockResolvedValue(SAMPLE_DETAIL);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getContact });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await GET(mkRequest(), mkParams("c-1"));
    expect(getApiClient).toHaveBeenCalled();
    expect(requireSession).toHaveBeenCalled();
  });
});
