import { describe, expect, it, vi } from "vitest";
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

import BillingPage from "../page";

describe("BillingPage", () => {
  it("renders plan cards when there is no subscription", () => {
    useSessionMock.mockReturnValue({ status: "authenticated" });

    render(<BillingPage />);

    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getByText("Choose a Plan")).toBeInTheDocument();
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Scale")).toBeInTheDocument();
  });
});
