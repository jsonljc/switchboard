import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { QueueZone } from "../queue-zone";

vi.mock("@/hooks/use-escalations");
vi.mock("@/hooks/use-approvals");

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

async function mockHooks(opts: {
  escalations?: { data?: unknown; isLoading?: boolean; error?: Error | null; refetch?: () => void };
  approvals?: { data?: unknown; isLoading?: boolean; error?: Error | null; refetch?: () => void };
}) {
  const escMod = await import("@/hooks/use-escalations");
  vi.mocked(escMod.useEscalations).mockReturnValue({
    data: opts.escalations?.data,
    isLoading: opts.escalations?.isLoading ?? false,
    error: opts.escalations?.error ?? null,
    refetch: opts.escalations?.refetch ?? vi.fn(),
  } as never);
  const apMod = await import("@/hooks/use-approvals");
  vi.mocked(apMod.useApprovals).mockReturnValue({
    data: opts.approvals?.data,
    isLoading: opts.approvals?.isLoading ?? false,
    error: opts.approvals?.error ?? null,
    refetch: opts.approvals?.refetch ?? vi.fn(),
  } as never);
}

describe("QueueZone", () => {
  it("renders skeleton while either hook is loading", async () => {
    await mockHooks({
      escalations: { isLoading: true },
      approvals: { isLoading: false, data: { approvals: [] } },
    });
    render(<QueueZone onOpenSlideOver={vi.fn()} />, { wrapper });
    expect(screen.getByLabelText(/loading queue/i)).toBeInTheDocument();
  });

  it("renders error state with retry that calls both refetches", async () => {
    const escRefetch = vi.fn();
    const apRefetch = vi.fn();
    await mockHooks({
      escalations: { error: new Error("boom"), refetch: escRefetch },
      approvals: { data: { approvals: [] }, refetch: apRefetch },
    });
    render(<QueueZone onOpenSlideOver={vi.fn()} />, { wrapper });
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /retry/i });
    await userEvent.click(retry);
    expect(escRefetch).toHaveBeenCalledTimes(1);
    expect(apRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders empty state when mapQueue returns no cards", async () => {
    await mockHooks({
      escalations: { data: { escalations: [] } },
      approvals: { data: { approvals: [] } },
    });
    render(<QueueZone onOpenSlideOver={vi.fn()} />, { wrapper });
    expect(screen.getByText(/no queue items right now/i)).toBeInTheDocument();
  });

  it("renders queue heading as a link to /escalations when cards exist", async () => {
    const now = new Date();
    await mockHooks({
      escalations: {
        data: {
          escalations: [
            {
              id: "esc-1",
              leadSnapshot: { name: "Sarah", channel: "WhatsApp" },
              reason: "Asking about a discount",
              createdAt: new Date(now.getTime() - 4 * 60_000).toISOString(),
            },
          ],
        },
      },
      approvals: { data: { approvals: [] } },
    });
    render(<QueueZone onOpenSlideOver={vi.fn()} />, { wrapper });
    const link = screen.getByRole("link", { name: /queue/i });
    expect(link).toHaveAttribute("href", "/escalations");
  });

  it("renders cards when both hooks return data and clicking a primary calls onOpenSlideOver", async () => {
    const onOpenSlideOver = vi.fn();
    const now = new Date();
    await mockHooks({
      escalations: {
        data: {
          escalations: [
            {
              id: "esc-1",
              leadSnapshot: { name: "Sarah", channel: "WhatsApp" },
              reason: "Asking about a discount",
              createdAt: new Date(now.getTime() - 4 * 60_000).toISOString(),
            },
          ],
        },
      },
      approvals: {
        data: {
          approvals: [
            {
              id: "ap-1",
              summary: "Campaign 01",
              riskContext: "Hooks ready",
              riskCategory: "creative",
              bindingHash: "binding-abc",
              createdAt: new Date(now.getTime() - 2 * 3600_000).toISOString(),
            },
          ],
        },
      },
    });
    render(<QueueZone onOpenSlideOver={onOpenSlideOver} />, { wrapper });
    expect(screen.getByText("Sarah")).toBeInTheDocument();
    expect(screen.getByText(/Campaign 01/)).toBeInTheDocument();

    // Click the approval gate primary ("Review →") — opens approval slide-over.
    const reviewBtn = screen.getByRole("button", { name: /review/i });
    await userEvent.click(reviewBtn);
    expect(onOpenSlideOver).toHaveBeenCalledWith({
      kind: "approval",
      approvalId: "ap-1",
      bindingHash: "binding-abc",
    });

    // Click the escalation primary ("Reply inline") — opens escalation slide-over.
    onOpenSlideOver.mockClear();
    const replyInline = screen.getByRole("button", { name: /reply inline/i });
    await userEvent.click(replyInline);
    expect(onOpenSlideOver).toHaveBeenCalledWith({
      kind: "escalation",
      escalationId: "esc-1",
    });
  });
});
