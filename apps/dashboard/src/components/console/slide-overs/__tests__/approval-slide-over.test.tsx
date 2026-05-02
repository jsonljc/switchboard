import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApprovalSlideOver } from "../approval-slide-over";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { principalId: "p-1" }, status: "authenticated" }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("ApprovalSlideOver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Approve and Reject buttons when open", () => {
    render(
      <ApprovalSlideOver approvalId="a-1" bindingHash="hash-1" open onOpenChange={() => {}} />,
      { wrapper },
    );
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });

  it("renders an 'Open full detail' deep-link to /decide/[id]", () => {
    render(
      <ApprovalSlideOver approvalId="a-1" bindingHash="hash-1" open onOpenChange={() => {}} />,
      { wrapper },
    );
    const link = screen.getByRole("link", { name: /full detail/i });
    expect(link).toHaveAttribute("href", "/decide/a-1");
  });

  it("calls approve with bindingHash on Approve click", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "approved" }),
    });
    const onOpenChange = vi.fn();
    render(
      <ApprovalSlideOver approvalId="a-1" bindingHash="hash-1" open onOpenChange={onOpenChange} />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/dashboard/approvals",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"action":"approve"'),
        }),
      );
    });
    const call = mockFetch.mock.calls[0]!;
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body).toMatchObject({
      approvalId: "a-1",
      action: "approve",
      bindingHash: "hash-1",
      respondedBy: "p-1",
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("surfaces error inline and keeps slide-over open when approve fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "approval rejected by policy" }),
    });
    const onOpenChange = vi.fn();
    render(
      <ApprovalSlideOver approvalId="a-1" bindingHash="hash-1" open onOpenChange={onOpenChange} />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/approval rejected by policy/i);
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
