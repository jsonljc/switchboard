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
// renders CockpitPage directly and no longer wraps it in a shell.
vi.mock("@/components/cockpit/cockpit-page", () => ({
  CockpitPage: () => <div data-testid="cockpit-page">cockpit</div>,
}));

import AlexPage from "../page";

describe("AlexPage server gate", () => {
  afterEach(() => {
    notFoundFn.mockClear();
    fetchEnabledFn.mockReset();
    fetchEnabledFn.mockImplementation(async () => ["alex", "riley"]);
  });

  it("renders CockpitPage when alex is enabled", async () => {
    const tree = await AlexPage();
    const { render, screen } = await import("@testing-library/react");
    render(tree);
    expect(screen.getByTestId("cockpit-page")).toBeInTheDocument();
  });

  it("notFound() when alex is not enabled", async () => {
    fetchEnabledFn.mockImplementation(async () => ["riley"]);
    await expect(AlexPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
