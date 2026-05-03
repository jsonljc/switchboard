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

async function mockAllZoneHooks() {
  const orgMod = await import("@/hooks/use-org-config");
  vi.mocked(orgMod.useOrgConfig).mockReturnValue({
    data: {
      config: {
        id: "org-1",
        name: "Aurora Dental",
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

describe("ConsoleView (Phase 1 frame)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("does NOT render NumbersStrip", async () => {
    await mockAllZoneHooks();
    render(wrap(<ConsoleView />));
    expect(screen.queryByLabelText(/today's numbers/i)).not.toBeInTheDocument();
  });

  it("renders the Halt button (Phase 1 reverses DC-41 deferral)", async () => {
    await mockAllZoneHooks();
    render(wrap(<ConsoleView />));
    expect(screen.getByRole("button", { name: "Halt" })).toBeInTheDocument();
  });

  it("renders the WelcomeBanner above the Queue when not dismissed", async () => {
    await mockAllZoneHooks();
    render(wrap(<ConsoleView />));
    expect(
      screen.getByRole("heading", { name: /welcome to your switchboard/i }),
    ).toBeInTheDocument();
  });

  it("hides the WelcomeBanner when localStorage flag is set", async () => {
    window.localStorage.setItem("sb_welcome_dismissed", "1");
    await mockAllZoneHooks();
    render(wrap(<ConsoleView />));
    expect(
      screen.queryByRole("heading", { name: /welcome to your switchboard/i }),
    ).not.toBeInTheDocument();
  });

  it("? key opens the HelpOverlay; Esc closes it", async () => {
    await mockAllZoneHooks();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<ConsoleView />));
    await user.keyboard("?");
    expect(screen.getByRole("heading", { name: /how switchboard works/i })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("heading", { name: /how switchboard works/i }),
    ).not.toBeInTheDocument();
  });

  it("H key toggles halt and fires a toast", async () => {
    await mockAllZoneHooks();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<ConsoleView />));
    await user.keyboard("h");
    // Use Resume button as the unambiguous halted-state indicator (avoids "Halted" text collision)
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByText(/all agents halted/i)).toBeInTheDocument();
  });

  it("clicking Help button opens overlay; clicking close button closes it", async () => {
    await mockAllZoneHooks();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<ConsoleView />));
    await user.click(screen.getByRole("button", { name: /\? help/i }));
    expect(screen.getByRole("heading", { name: /how switchboard works/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(
      screen.queryByRole("heading", { name: /how switchboard works/i }),
    ).not.toBeInTheDocument();
  });
});
