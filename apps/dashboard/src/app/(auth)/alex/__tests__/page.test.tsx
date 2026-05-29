import { describe, expect, it, vi, afterEach } from "vitest";

// The /alex cockpit was retired; the route is now a thin redirect to the agent
// panel deep-link on Home. redirect() throws internally in Next, so we mock it.
const { redirectFn } = vi.hoisted(() => {
  const redirectFn = vi.fn((_url: string) => {
    throw new Error("NEXT_REDIRECT");
  });
  return { redirectFn };
});

vi.mock("next/navigation", () => ({ redirect: redirectFn }));

import AlexPage from "../page";

describe("AlexPage redirect stub", () => {
  afterEach(() => redirectFn.mockClear());

  it("redirects to the Alex agent-panel deep-link on Home", async () => {
    await expect(AlexPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectFn).toHaveBeenCalledWith("/?agent=alex");
  });
});
