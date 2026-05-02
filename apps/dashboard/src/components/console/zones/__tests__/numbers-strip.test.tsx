import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NumbersStrip } from "../numbers-strip";

vi.mock("@/hooks/use-dashboard-overview");

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("NumbersStrip", () => {
  it("renders skeleton while loading", async () => {
    const mod = await import("@/hooks/use-dashboard-overview");
    vi.mocked(mod.useDashboardOverview).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(<NumbersStrip />, { wrapper });
    expect(screen.getByLabelText(/loading numbers/i)).toBeInTheDocument();
  });

  it("renders error state with retry on hook error", async () => {
    const refetch = vi.fn();
    const mod = await import("@/hooks/use-dashboard-overview");
    vi.mocked(mod.useDashboardOverview).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
      refetch,
    } as never);
    render(<NumbersStrip />, { wrapper });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders cells when data is present", async () => {
    const mod = await import("@/hooks/use-dashboard-overview");
    vi.mocked(mod.useDashboardOverview).mockReturnValue({
      data: {
        stats: { newInquiriesToday: 7, newInquiriesYesterday: 5 },
        bookings: [],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(<NumbersStrip />, { wrapper });
    expect(screen.getByText(/leads today/i)).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
