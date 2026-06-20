import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useSessionMock = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/hooks/use-identity", () => ({
  useIdentity: () => ({
    data: {
      spec: {
        id: "spec_1",
        globalSpendLimits: {},
        governanceProfile: "guarded",
        forbiddenBehaviors: [],
      },
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateIdentity: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: () => ({ data: { config: { name: "Acme Clinic", currency: "SGD" } } }),
  useUpdateOrgConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-agents", () => ({
  useAgentRoster: () => ({
    data: {
      roster: [{ id: "agent_1", agentRole: "primary_operator", displayName: "Alex" }],
    },
  }),
  useUpdateAgentRoster: () => ({ mutate: vi.fn() }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

vi.mock("@/lib/sign-out", () => ({
  signOut: vi.fn(),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

beforeEach(() => {
  useSessionMock.mockReturnValue({ status: "authenticated" });
});

describe("SettingsAccountPage", () => {
  it("renders the general settings card", async () => {
    const { default: SettingsAccountPage } = await import("../page");
    render(<SettingsAccountPage />);

    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Business Name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
  });

  it("does not render a reachable Light/Dark/System theme toggle", async () => {
    // Audit C1 / PR #826: the dark palette styles only ~40 of ~178 tokens, so a
    // reachable theme picker flips the whole authed shell into a half-styled dark
    // register (applyTheme toggles `.dark` on documentElement). Keep it removed
    // until the dark register is real. This guard fails if the toggle returns.
    const { default: SettingsAccountPage } = await import("../page");
    render(<SettingsAccountPage />);

    expect(screen.queryByText("Theme")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Light" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dark" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "System" })).not.toBeInTheDocument();
  });
});
