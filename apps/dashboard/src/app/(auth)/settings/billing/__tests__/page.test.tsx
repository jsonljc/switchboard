import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useSessionMock = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/hooks/use-billing", () => ({
  useBillingStatus: () => ({
    data: {
      subscriptionId: null,
      status: "none",
      planName: null,
      priceId: null,
      currentPeriodEnd: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCheckout: () => ({ mutate: vi.fn(), isPending: false }),
  usePortal: () => ({ mutate: vi.fn(), isPending: false }),
}));

beforeEach(() => {
  useSessionMock.mockReturnValue({ status: "authenticated" });
});

describe("BillingPage", () => {
  it("shows coming-soon placeholder when Stripe price env vars are not set", async () => {
    // Price env vars are not set in test environment, so the page shows placeholder
    const { default: BillingPage } = await import("../page");
    render(<BillingPage />);

    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getByText("Billing will be available soon")).toBeInTheDocument();
  });
});
