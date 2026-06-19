import { describe, expect, it, vi, afterEach } from "vitest";

// Mira is opt-in per org. When it is NOT enabled, /mira falls back to Home's
// `?agent=mira` deep-link (the read-only agent panel) instead of a bare 404,
// mirroring the retired /alex and /riley routes. redirect() throws internally
// in Next, so we mock it.
const { redirectFn } = vi.hoisted(() => {
  const redirectFn = vi.fn((_url: string) => {
    throw new Error("NEXT_REDIRECT");
  });
  return { redirectFn };
});

vi.mock("next/navigation", () => ({ redirect: redirectFn }));
vi.mock("@/lib/api-client/agents-server", () => ({
  fetchEnabledAgentsServer: vi.fn(async () => [] as string[]),
}));
vi.mock("@/components/cockpit/mira/mira-desk-page", () => ({
  MiraDeskPage: () => null,
}));

import MiraPage from "../page";

describe("MiraPage fallback", () => {
  afterEach(() => redirectFn.mockClear());

  it("redirects to the Mira agent-panel deep-link when Mira is not enabled", async () => {
    await expect(MiraPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectFn).toHaveBeenCalledWith("/?agent=mira");
  });
});
