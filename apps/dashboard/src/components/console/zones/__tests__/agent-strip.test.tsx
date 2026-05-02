import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AgentStrip } from "../agent-strip";

vi.mock("@/hooks/use-agents");
vi.mock("@/hooks/use-module-status");

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

async function mockHooks(opts: {
  roster?: { data?: unknown; isLoading?: boolean; error?: Error | null; refetch?: () => void };
  state?: { data?: unknown; isLoading?: boolean; error?: Error | null; refetch?: () => void };
  modules?: { data?: unknown; isLoading?: boolean; error?: Error | null; refetch?: () => void };
}) {
  const agentsMod = await import("@/hooks/use-agents");
  vi.mocked(agentsMod.useAgentRoster).mockReturnValue({
    data: opts.roster?.data,
    isLoading: opts.roster?.isLoading ?? false,
    error: opts.roster?.error ?? null,
    refetch: opts.roster?.refetch ?? vi.fn(),
  } as never);
  vi.mocked(agentsMod.useAgentState).mockReturnValue({
    data: opts.state?.data,
    isLoading: opts.state?.isLoading ?? false,
    error: opts.state?.error ?? null,
    refetch: opts.state?.refetch ?? vi.fn(),
  } as never);
  const modMod = await import("@/hooks/use-module-status");
  vi.mocked(modMod.useModuleStatus).mockReturnValue({
    data: opts.modules?.data,
    isLoading: opts.modules?.isLoading ?? false,
    error: opts.modules?.error ?? null,
    refetch: opts.modules?.refetch ?? vi.fn(),
  } as never);
}

describe("AgentStrip", () => {
  it("renders skeleton while any hook is loading", async () => {
    await mockHooks({
      roster: { isLoading: true },
      state: { data: { states: [] } },
      modules: { data: [] },
    });
    render(<AgentStrip />, { wrapper });
    expect(screen.getByLabelText(/loading agents/i)).toBeInTheDocument();
  });

  it("renders error state with retry that calls all three refetches", async () => {
    const rosterRefetch = vi.fn();
    const stateRefetch = vi.fn();
    const moduleRefetch = vi.fn();
    await mockHooks({
      roster: { error: new Error("boom"), refetch: rosterRefetch },
      state: { data: { states: [] }, refetch: stateRefetch },
      modules: { data: [], refetch: moduleRefetch },
    });
    render(<AgentStrip />, { wrapper });
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /retry/i });
    await userEvent.click(retry);
    expect(rosterRefetch).toHaveBeenCalledTimes(1);
    expect(stateRefetch).toHaveBeenCalledTimes(1);
    expect(moduleRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders three agents with no 'pending option C' jargon when all hooks return data", async () => {
    await mockHooks({
      roster: { data: { roster: [] } },
      state: { data: { states: [] } },
      modules: { data: [{ id: "ad-optimizer", state: "live" }] },
    });
    render(<AgentStrip />, { wrapper });
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Nova")).toBeInTheDocument();
    expect(screen.getByText("Mira")).toBeInTheDocument();
    // DC-02 jargon must not survive
    expect(screen.queryByText(/pending option c/i)).not.toBeInTheDocument();
  });

  it("renders 'view conversations →' links pointing to /conversations", async () => {
    await mockHooks({
      roster: { data: { roster: [] } },
      state: { data: { states: [] } },
      modules: { data: [] },
    });
    render(<AgentStrip />, { wrapper });
    const links = screen.getAllByRole("link", { name: /view conversations/i });
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/conversations");
    }
  });
});
