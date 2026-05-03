import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

async function mockZones() {
  const orgMod = await import("@/hooks/use-org-config");
  vi.mocked(orgMod.useOrgConfig).mockReturnValue({
    data: {
      config: {
        id: "org-1",
        name: "Acme",
        runtimeType: "default",
        runtimeConfig: {},
        governanceProfile: "default",
        onboardingComplete: true,
        managedChannels: [],
        provisioningStatus: "active",
      },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as never);
  const loading = { data: undefined, isLoading: true, error: null, refetch: vi.fn() };
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

describe("ConsoleView Halt — single source", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("button click and H key share the same halted state across alternating toggles", async () => {
    await mockZones();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<ConsoleView />));

    expect(screen.getByRole("button", { name: "Halt" })).toBeInTheDocument();

    // Click button → halted
    await user.click(screen.getByRole("button", { name: "Halt" }));
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();

    // Press H → live (state shared, no double-toggle)
    await user.keyboard("h");
    expect(screen.getByRole("button", { name: "Halt" })).toBeInTheDocument();

    // Click button again → halted (third toggle, no race)
    await user.click(screen.getByRole("button", { name: "Halt" }));
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("does not call document.querySelector for .op-halt in the keyboard handler", async () => {
    await mockZones();
    const spy = vi.spyOn(document, "querySelector");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<ConsoleView />));
    spy.mockClear();
    await user.keyboard("h");
    const calledForOpHalt = spy.mock.calls.some(
      ([selector]) => typeof selector === "string" && selector.includes(".op-halt"),
    );
    expect(calledForOpHalt).toBe(false);
    spy.mockRestore();
  });
});
