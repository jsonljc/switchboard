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
vi.mock("@/components/layout/editorial-auth-shell", () => ({
  EditorialAuthShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/agent-home/agent-home-shell", () => ({
  AgentHomeShell: ({ agentKey }: { agentKey: string }) => <div data-testid="shell">{agentKey}</div>,
}));

import AlexPage from "../page";

describe("AlexPage server gate", () => {
  afterEach(() => {
    notFoundFn.mockClear();
    fetchEnabledFn.mockReset();
    fetchEnabledFn.mockImplementation(async () => ["alex", "riley"]);
  });

  it("renders AgentHomeShell with agentKey=alex when alex is enabled", async () => {
    const tree = await AlexPage();
    const { render, screen } = await import("@testing-library/react");
    render(tree);
    expect(screen.getByTestId("shell")).toHaveTextContent("alex");
  });

  it("notFound() when alex is not enabled", async () => {
    fetchEnabledFn.mockImplementation(async () => ["riley"]);
    await expect(AlexPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
