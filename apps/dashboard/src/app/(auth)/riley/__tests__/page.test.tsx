import { afterEach, describe, expect, it, vi } from "vitest";

const { notFoundFn, fetchEnabledFn } = vi.hoisted(() => {
  const notFoundFn = vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  const fetchEnabledFn = vi.fn(async () => ["alex", "riley"]);
  return { notFoundFn, fetchEnabledFn };
});

vi.mock("next/navigation", () => ({ notFound: notFoundFn }));
vi.mock("@/lib/api-client/agents-server", () => ({
  fetchEnabledAgentsServer: fetchEnabledFn,
}));
// The editorial shell is mounted once by the (auth) layout's AppShell — the page
// renders RileyCockpitPage directly and no longer wraps it in a shell.
vi.mock("@/components/cockpit/riley-cockpit-page", () => ({
  RileyCockpitPage: () => <div data-testid="riley-cockpit-page">riley-cockpit</div>,
}));

import RileyPage from "../page";

describe("RileyPage server gate", () => {
  afterEach(() => {
    notFoundFn.mockClear();
    fetchEnabledFn.mockReset();
    fetchEnabledFn.mockImplementation(async () => ["alex", "riley"]);
  });

  it("renders RileyCockpitPage when riley is enabled", async () => {
    const tree = await RileyPage();
    const { render, screen } = await import("@testing-library/react");
    render(tree);
    expect(screen.getByTestId("riley-cockpit-page")).toBeInTheDocument();
  });

  it("notFound() when riley is not enabled", async () => {
    fetchEnabledFn.mockImplementation(async () => ["alex"]);
    await expect(RileyPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
