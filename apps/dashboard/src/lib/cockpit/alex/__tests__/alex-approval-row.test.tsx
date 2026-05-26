// apps/dashboard/src/lib/cockpit/alex/__tests__/alex-approval-row.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AlexApprovalView } from "@/components/cockpit/types";

// Hoisted mocks must be declared before the import they replace. Vitest's
// vi.mock() factory runs before module evaluation, so the mock references
// must come from vi.hoisted (or be inlined in the factory).
const { mockMutate, toastMock } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  toastMock: vi.fn(),
}));

// Per the brief's "verdict-to-action mapping" lock: the row owns the
// translation from the ApprovalCard's `verdict: "accept" | "decline"` callback
// shape into `useRespondToApproval`'s `action: "approve" | "reject"`
// mutation input. Decline omits bindingHash; Accept includes it.
vi.mock("@/lib/cockpit/approvals/use-approvals", () => ({
  useRespondToApproval: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { AlexApprovalRow } from "../alex-approval-row";

const baseApproval: AlexApprovalView = {
  id: "appr_1",
  kind: "pricing",
  urgency: "immediate",
  askedAt: "2m ago",
  title: "Refund request",
  presentation: { primaryLabel: "Accept", dismissLabel: "Decline" },
  primary: "Accept",
  secondary: "Decline",
  primaryAction: { kind: "respond", bindingHash: "h1", verdict: "accept" },
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrap(ui: ReactNode) {
  const qc = makeClient();
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("AlexApprovalRow", () => {
  beforeEach(() => {
    mockMutate.mockReset();
    toastMock.mockReset();
  });

  it("requires confirmation before Accept dispatches mutate({ action: 'approve', bindingHash })", () => {
    render(wrap(<AlexApprovalRow approval={baseApproval} idx={0} total={1} />));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    // Safety gate: the first tap opens a confirm step — nothing commits yet.
    expect(mockMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /yes, accept/i }));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]?.[0]).toEqual({
      id: "appr_1",
      action: "approve",
      bindingHash: "h1",
    });
  });

  it("does NOT commit on a single Accept tap — opens a confirm step instead", () => {
    render(wrap(<AlexApprovalRow approval={baseApproval} idx={0} total={1} />));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /confirm — alex/i })).toBeInTheDocument();
  });

  it("cancelling the confirm step aborts Accept without committing", () => {
    render(wrap(<AlexApprovalRow approval={baseApproval} idx={0} total={1} />));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /confirm — alex/i })).not.toBeInTheDocument();
  });

  it("dispatches mutate({ action: 'reject' }) on Decline without bindingHash", () => {
    render(wrap(<AlexApprovalRow approval={baseApproval} idx={0} total={1} />));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const arg = mockMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).toEqual({ id: "appr_1", action: "reject" });
    expect(arg).not.toHaveProperty("bindingHash");
  });

  it("hides the card optimistically on click and toasts on success", async () => {
    // mutate signature: (input, options) — call options.onSuccess synchronously
    // to simulate the resolved mutation. The row's onResolve hides the card
    // optimistically (synchronously) before mutate fires, and toasts in
    // onSuccess.
    mockMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });
    render(wrap(<AlexApprovalRow approval={baseApproval} idx={0} total={1} />));
    expect(screen.getByText("Refund request")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: /yes, accept/i }));
    await waitFor(() => {
      expect(screen.queryByText("Refund request")).not.toBeInTheDocument();
    });
    expect(toastMock).toHaveBeenCalledTimes(1);
    const toastArg = toastMock.mock.calls[0]?.[0] as { title: string };
    expect(toastArg.title).toMatch(/approved/i);
  });

  it("keeps the card visible and toasts an error when mutate.onError fires", async () => {
    mockMutate.mockImplementation((_input, options) => {
      options?.onError?.(new Error("boom"));
    });
    render(wrap(<AlexApprovalRow approval={baseApproval} idx={0} total={1} />));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: /yes, accept/i }));
    // Card stays visible — the optimistic dismiss is reverted on error.
    await waitFor(() => {
      expect(screen.getByText("Refund request")).toBeInTheDocument();
    });
    expect(toastMock).toHaveBeenCalledTimes(1);
    const toastArg = toastMock.mock.calls[0]?.[0] as { title: string };
    expect(toastArg.title).toMatch(/could not/i);
  });

  it("uses the 'Alex needs you' sender label", () => {
    render(wrap(<AlexApprovalRow approval={baseApproval} idx={0} total={1} />));
    expect(screen.getByText(/Alex needs you/i)).toBeInTheDocument();
  });

  it("uses the view's acceptToast copy when present (spec criterion 6)", () => {
    mockMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });
    const approval: AlexApprovalView = { ...baseApproval, acceptToast: "Refund processed" };
    render(wrap(<AlexApprovalRow approval={approval} idx={0} total={1} />));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: /yes, accept/i }));
    expect(toastMock).toHaveBeenCalledTimes(1);
    const toastArg = toastMock.mock.calls[0]?.[0] as { title: string };
    expect(toastArg.title).toBe("Refund processed");
  });

  it("uses the view's declineToast copy when present (spec criterion 6)", () => {
    mockMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });
    const approval: AlexApprovalView = { ...baseApproval, declineToast: "Refund declined" };
    render(wrap(<AlexApprovalRow approval={approval} idx={0} total={1} />));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(toastMock).toHaveBeenCalledTimes(1);
    const toastArg = toastMock.mock.calls[0]?.[0] as { title: string };
    expect(toastArg.title).toBe("Refund declined");
  });

  it("falls back to hardcoded 'Approved'/'Declined' copy when toast overrides absent", () => {
    mockMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });
    render(wrap(<AlexApprovalRow approval={baseApproval} idx={0} total={1} />));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: /yes, accept/i }));
    const toastArg = toastMock.mock.calls[0]?.[0] as { title: string };
    expect(toastArg.title).toBe("Approved");
  });
});
