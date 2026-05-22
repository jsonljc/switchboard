import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwitchboardDashboardClient } from "../dashboard";
import { SwitchboardGovernanceClient } from "../governance";

/**
 * Preflight test for Route Governance Contract v1 PR-1.
 *
 * The 7 operator-direct mutation endpoints will soon mandate an
 * `Idempotency-Key` header server-side. These three api-client methods
 * are the server-to-server callers that hit those endpoints from the
 * Next.js proxy routes — they must inject the header BEFORE the server
 * mandate lands so the rollout is a no-op from the UI side.
 */

const fetchMock = vi.fn();
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^idemp_\d+_[a-z0-9]+$/i;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function headersFromCall(call: unknown): Record<string, string> {
  const [, init] = call as [string, RequestInit];
  return (init.headers ?? {}) as Record<string, string>;
}

describe("Idempotency-Key injection on operator-direct mutations", () => {
  it("actOnRecommendation sends an Idempotency-Key on POST /api/recommendations/:id/act", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ ok: true }),
    });

    const client = new SwitchboardGovernanceClient("http://api.test", "key-123");
    await client.actOnRecommendation("11111111-2222-3333-4444-555555555555", {
      action: "primary",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = headersFromCall(fetchMock.mock.calls[0]);
    expect(headers["Idempotency-Key"]).toBeDefined();
    expect(headers["Idempotency-Key"]).toMatch(UUID_RE);
  });

  it("resolveDisqualification sends an Idempotency-Key on POST /api/dashboard/lifecycle/disqualifications/:id/(confirm|dismiss)", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ ok: true }),
    });

    const client = new SwitchboardDashboardClient("http://api.test", "key-123");
    await client.resolveDisqualification("thread-abc", "confirm", {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = headersFromCall(fetchMock.mock.calls[0]);
    expect(headers["Idempotency-Key"]).toBeDefined();
    expect(headers["Idempotency-Key"]).toMatch(UUID_RE);
  });

  it("patchOpportunityStage sends an Idempotency-Key on PATCH /api/dashboard/opportunities/:id/stage", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ opportunity: { id: "o-1" } }),
    });

    const client = new SwitchboardDashboardClient("http://api.test", "key-123");
    await client.patchOpportunityStage("o-1", "active" as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = headersFromCall(fetchMock.mock.calls[0]);
    expect(headers["Idempotency-Key"]).toBeDefined();
    expect(headers["Idempotency-Key"]).toMatch(UUID_RE);
  });

  it("generates a fresh Idempotency-Key per call (no reuse across mutations)", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ ok: true, opportunity: { id: "o-1" } }),
    });

    const client = new SwitchboardDashboardClient("http://api.test", "key-123");
    await client.patchOpportunityStage("o-1", "active" as never);
    await client.patchOpportunityStage("o-1", "active" as never);

    const k1 = headersFromCall(fetchMock.mock.calls[0])["Idempotency-Key"];
    const k2 = headersFromCall(fetchMock.mock.calls[1])["Idempotency-Key"];
    expect(k1).toBeDefined();
    expect(k2).toBeDefined();
    expect(k1).not.toBe(k2);
  });
});
