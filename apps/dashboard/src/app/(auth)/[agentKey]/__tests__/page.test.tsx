import { afterEach, describe, expect, it, vi } from "vitest";

const { notFoundFn } = vi.hoisted(() => {
  const notFoundFn = vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  return { notFoundFn };
});

vi.mock("next/navigation", () => ({ notFound: notFoundFn }));
vi.mock("@/lib/api-client/agents-server", () => ({
  fetchEnabledAgentsServer: vi.fn(async () => ["alex", "riley"]),
}));
vi.mock("@/components/layout/editorial-auth-shell", () => ({
  EditorialAuthShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/agent-home/agent-home-shell", () => ({
  AgentHomeShell: ({ agentKey }: { agentKey: string }) => (
    <div data-testid="client">{agentKey}</div>
  ),
}));

import AgentHomePage from "../page";

const ORIG_ENV = process.env.NEXT_PUBLIC_DEPLOY_ENV;

describe("AgentHomePage server gates", () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = ORIG_ENV;
    notFoundFn.mockClear();
  });

  it("notFound() when agentKey is not in registry", async () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    await expect(AgentHomePage({ params: Promise.resolve({ agentKey: "bogus" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("notFound() when agentKey is mira (not enabled in slice B)", async () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    await expect(AgentHomePage({ params: Promise.resolve({ agentKey: "mira" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("renders AgentHomeShell for valid + enabled agent", async () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    const tree = await AgentHomePage({ params: Promise.resolve({ agentKey: "alex" }) });
    const { render, screen } = await import("@testing-library/react");
    render(tree);
    expect(screen.getByTestId("client")).toHaveTextContent("alex");
  });
});
