import { describe, expect, it, vi, afterEach } from "vitest";

// Mira is opt-in per org. When it is NOT enabled, /mira falls back to Home's
// `?agent=mira` deep-link (the read-only agent panel) instead of a bare 404,
// mirroring the retired /alex and /riley routes. When enabled it renders the
// Director's Desk. redirect() throws internally in Next, so we mock it.
const { redirectFn } = vi.hoisted(() => {
  const redirectFn = vi.fn((_url: string) => {
    throw new Error("NEXT_REDIRECT");
  });
  return { redirectFn };
});
const { fetchEnabledAgentsServer } = vi.hoisted(() => ({
  fetchEnabledAgentsServer: vi.fn(async () => [] as string[]),
}));

vi.mock("next/navigation", () => ({ redirect: redirectFn }));
vi.mock("@/lib/api-client/agents-server", () => ({ fetchEnabledAgentsServer }));
vi.mock("@/components/cockpit/mira/mira-desk-page", () => ({ MiraDeskPage: () => null }));

import MiraPage from "../page";

describe("MiraPage", () => {
  afterEach(() => {
    redirectFn.mockClear();
    fetchEnabledAgentsServer.mockReset();
  });

  it("redirects to the Mira agent-panel deep-link when Mira is not enabled", async () => {
    fetchEnabledAgentsServer.mockResolvedValue([]);
    await expect(MiraPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectFn).toHaveBeenCalledWith("/?agent=mira");
  });

  it("renders the desk without redirecting when Mira is enabled", async () => {
    fetchEnabledAgentsServer.mockResolvedValue(["mira"]);
    const element = await MiraPage();
    expect(redirectFn).not.toHaveBeenCalled();
    expect(element).toBeTruthy();
  });
});
