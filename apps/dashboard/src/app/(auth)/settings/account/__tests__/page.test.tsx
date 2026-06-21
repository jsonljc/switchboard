import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const refetchMock = vi.fn();

const useSessionMock = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

const useIdentityMock = vi.fn();
vi.mock("@/hooks/use-identity", () => ({
  useIdentity: () => useIdentityMock(),
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
  vi.clearAllMocks();
  useSessionMock.mockReturnValue({ status: "authenticated" });
  useIdentityMock.mockReturnValue({
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
    refetch: refetchMock,
  });
});

describe("SettingsAccountPage", () => {
  it("renders the general settings card", async () => {
    const { default: SettingsAccountPage } = await import("../page");
    render(<SettingsAccountPage />);

    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Business Name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
  });

  it("renders a StatePanel error state when identity query fails", async () => {
    useIdentityMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
      refetch: refetchMock,
    });
    const { default: SettingsAccountPage } = await import("../page");
    render(<SettingsAccountPage />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    // eyebrow "Couldn't load" and title both contain "couldn't load" — use getAllByText
    expect(screen.getAllByText(/couldn't load/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/we couldn't load your account/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    // Old raw error text must NOT appear
    expect(screen.queryByText(/failed to load settings/i)).not.toBeInTheDocument();
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
