import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ConsoleView } from "../console-view";

vi.mock("@/hooks/use-org-config");
vi.mock("@/hooks/use-dashboard-overview");
vi.mock("@/hooks/use-escalations");
vi.mock("@/hooks/use-approvals");
vi.mock("@/hooks/use-agents");
vi.mock("@/hooks/use-module-status");
vi.mock("@/hooks/use-audit");

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

async function mockAllZoneHooksLoading() {
  const loading = { data: undefined, isLoading: true, error: null, refetch: vi.fn() };
  const orgMod = await import("@/hooks/use-org-config");
  vi.mocked(orgMod.useOrgConfig).mockReturnValue(loading as never);
  const overviewMod = await import("@/hooks/use-dashboard-overview");
  vi.mocked(overviewMod.useDashboardOverview).mockReturnValue(loading as never);
  const escMod = await import("@/hooks/use-escalations");
  vi.mocked(escMod.useEscalations).mockReturnValue(loading as never);
  const apMod = await import("@/hooks/use-approvals");
  vi.mocked(apMod.useApprovals).mockReturnValue(loading as never);
  const agentsMod = await import("@/hooks/use-agents");
  vi.mocked(agentsMod.useAgentRoster).mockReturnValue(loading as never);
  vi.mocked(agentsMod.useAgentState).mockReturnValue(loading as never);
  const modulesMod = await import("@/hooks/use-module-status");
  vi.mocked(modulesMod.useModuleStatus).mockReturnValue(loading as never);
  const auditMod = await import("@/hooks/use-audit");
  vi.mocked(auditMod.useAudit).mockReturnValue(loading as never);
}

describe("ConsoleView Halt button", () => {
  it("renders OpStrip skeleton (and no Halt button) while org config is loading", async () => {
    await mockAllZoneHooksLoading();
    const { queryByText } = render(<ConsoleView />, { wrapper });
    // When org config is loading, OpStrip renders a skeleton — no Halt button visible
    expect(queryByText(/^Halt$/)).not.toBeInTheDocument();
  });
});
