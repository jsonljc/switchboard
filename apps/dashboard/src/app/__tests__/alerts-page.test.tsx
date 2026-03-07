import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

// Mock next-auth/react so useSession doesn't require a SessionProvider
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ status: "authenticated", data: { user: { name: "Test" } } })),
  SessionProvider: ({ children }: { children: ReactNode }) => children,
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// Mock the hooks
vi.mock("@/hooks/use-alerts", () => ({
  useAlerts: vi.fn(),
  useCreateAlert: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateAlert: vi.fn(() => ({ mutate: vi.fn() })),
  useDeleteAlert: vi.fn(() => ({ mutate: vi.fn() })),
  useAlertHistory: vi.fn(() => ({ data: [], isLoading: false })),
}));

// Mock the AlertRuleCard and AlertRuleForm to simplify testing
vi.mock("@/components/alerts/alert-rule-card", () => ({
  AlertRuleCard: ({ rule }: { rule: { name: string } }) => (
    <div data-testid="alert-card">{rule.name}</div>
  ),
}));

vi.mock("@/components/alerts/alert-rule-form", () => ({
  AlertRuleForm: ({ open }: { open: boolean }) =>
    open ? <div data-testid="alert-form">Form</div> : null,
}));

vi.mock("@/components/alerts/alert-history-list", () => ({
  AlertHistoryList: () => <div data-testid="alert-history">History</div>,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("AlertsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading skeletons while fetching", async () => {
    const { useAlerts } = await import("@/hooks/use-alerts");
    (useAlerts as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const AlertsPage = (await import("@/app/alerts/page")).default;
    render(<AlertsPage />, { wrapper: createWrapper() });

    expect(screen.getByText("Alerts")).toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("shows empty state when no alerts", async () => {
    const { useAlerts } = await import("@/hooks/use-alerts");
    (useAlerts as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
    });

    const AlertsPage = (await import("@/app/alerts/page")).default;
    render(<AlertsPage />, { wrapper: createWrapper() });

    expect(screen.getByText("No alert rules configured.")).toBeInTheDocument();
  });

  it("renders alert cards when data is available", async () => {
    const { useAlerts } = await import("@/hooks/use-alerts");
    (useAlerts as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        { id: "a1", name: "High CPA" },
        { id: "a2", name: "Low Spend" },
      ],
      isLoading: false,
    });

    const AlertsPage = (await import("@/app/alerts/page")).default;
    render(<AlertsPage />, { wrapper: createWrapper() });

    const cards = screen.getAllByTestId("alert-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByText("High CPA")).toBeInTheDocument();
    expect(screen.getByText("Low Spend")).toBeInTheDocument();
  });

  it("has a New Alert button", async () => {
    const { useAlerts } = await import("@/hooks/use-alerts");
    (useAlerts as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
    });

    const AlertsPage = (await import("@/app/alerts/page")).default;
    render(<AlertsPage />, { wrapper: createWrapper() });

    expect(screen.getByText("New Alert")).toBeInTheDocument();
  });
});
