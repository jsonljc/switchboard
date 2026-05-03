import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { QueueZone } from "../queue-zone";
import { ToastProvider } from "../../use-toast";

vi.mock("@/hooks/use-escalations");
vi.mock("@/hooks/use-approvals");
vi.mock("@/hooks/use-escalation-reply");
vi.mock("@/hooks/use-approval-action");
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(ui: React.ReactElement, qc?: QueryClient) {
  const client = qc ?? makeClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return { ...render(ui, { wrapper: Wrapper }), client };
}

const escRow = {
  id: "esc-1",
  leadSnapshot: { name: "Sarah", channel: "WhatsApp" },
  reason: "Asking about a discount",
  createdAt: new Date().toISOString(),
};

async function mockQueueHooks(opts: {
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
  vi.mocked(escMod.useEscalationDetail).mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
  } as never);
  const apMod = await import("@/hooks/use-approvals");
  vi.mocked(apMod.useApprovals).mockReturnValue({
    data: opts.approvals?.data,
    isLoading: opts.approvals?.isLoading ?? false,
    error: opts.approvals?.error ?? null,
    refetch: opts.approvals?.refetch ?? vi.fn(),
  } as never);
  const replyMod = await import("@/hooks/use-escalation-reply");
  vi.mocked(replyMod.useEscalationReply).mockReturnValue({
    send: vi.fn(),
    isPending: false,
  } as never);
  const acMod = await import("@/hooks/use-approval-action");
  vi.mocked(acMod.useApprovalAction).mockReturnValue({
    approve: vi.fn(),
    reject: vi.fn(),
    isPending: false,
    error: null,
  } as never);
}

describe("QueueZone", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders skeleton while either hook is loading", async () => {
    await mockQueueHooks({
      escalations: { isLoading: true },
      approvals: { data: { approvals: [] } },
    });
    render(<QueueZone />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={makeClient()}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      ),
    });
    expect(screen.getByLabelText(/loading queue/i)).toBeInTheDocument();
  });

  it("renders error state with retry that calls both refetches", async () => {
    const escRefetch = vi.fn();
    const apRefetch = vi.fn();
    await mockQueueHooks({
      escalations: { error: new Error("boom"), refetch: escRefetch },
      approvals: { data: { approvals: [] }, refetch: apRefetch },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<QueueZone />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={makeClient()}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      ),
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(escRefetch).toHaveBeenCalledTimes(1);
    expect(apRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders empty state when mapQueue returns no cards", async () => {
    await mockQueueHooks({
      escalations: { data: { escalations: [] } },
      approvals: { data: { approvals: [] } },
    });
    render(<QueueZone />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={makeClient()}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      ),
    });
    expect(screen.getByText(/no queue items right now/i)).toBeInTheDocument();
  });

  it("renders queue heading as a link to /escalations when cards exist", async () => {
    await mockQueueHooks({
      escalations: { data: { escalations: [escRow] } },
      approvals: { data: { approvals: [] } },
    });
    render(<QueueZone />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={makeClient()}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      ),
    });
    expect(screen.getByRole("link", { name: /queue/i })).toHaveAttribute("href", "/escalations");
  });

  it("applies is-resolving class on the card after a successful escalation reply", async () => {
    const replyMod = await import("@/hooks/use-escalation-reply");
    vi.mocked(replyMod.useEscalationReply).mockReturnValue({
      send: vi.fn().mockResolvedValue({ ok: true, escalation: { id: "esc-1" } }),
      isPending: false,
    } as never);
    await mockQueueHooks({
      escalations: { data: { escalations: [escRow] } },
      approvals: { data: { approvals: [] } },
    });
    // Re-mock useEscalationReply *after* the helper, since the helper sets defaults.
    vi.mocked(replyMod.useEscalationReply).mockReturnValue({
      send: vi.fn().mockResolvedValue({ ok: true, escalation: { id: "esc-1" } }),
      isPending: false,
    } as never);
    const { container } = wrap(<QueueZone />);
    const escCard = container.querySelector(".qcard.escalation") as HTMLElement;
    expect(escCard.classList.contains("is-resolving")).toBe(false);

    // Expand the inline panel and find the Send button inside <ReplyForm>.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(escCard.querySelector<HTMLButtonElement>(".esc-reply")!);
    const textarea = escCard.querySelector<HTMLTextAreaElement>(".reply-form-text")!;
    await user.type(textarea, "thanks");
    await user.click(escCard.querySelector<HTMLButtonElement>(".reply-form-send")!);

    // After the send promise resolves, onResolve fires synchronously and the card
    // class should be `is-resolving` until the 320ms timer expires.
    await vi.waitFor(() => {
      expect(escCard.classList.contains("is-resolving")).toBe(true);
    });
  });

  it("invalidates queries 320ms after resolve", async () => {
    const replyMod = await import("@/hooks/use-escalation-reply");
    await mockQueueHooks({
      escalations: { data: { escalations: [escRow] } },
      approvals: { data: { approvals: [] } },
    });
    vi.mocked(replyMod.useEscalationReply).mockReturnValue({
      send: vi.fn().mockResolvedValue({ ok: true, escalation: { id: "esc-1" } }),
      isPending: false,
    } as never);
    const { container, client } = wrap(<QueueZone />);
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const escCard = container.querySelector(".qcard.escalation") as HTMLElement;
    await user.click(escCard.querySelector<HTMLButtonElement>(".esc-reply")!);
    await user.type(escCard.querySelector<HTMLTextAreaElement>(".reply-form-text")!, "thanks");
    await user.click(escCard.querySelector<HTMLButtonElement>(".reply-form-send")!);

    await vi.waitFor(() => {
      expect(escCard.classList.contains("is-resolving")).toBe(true);
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(320);
    });
    expect(invalidateSpy).toHaveBeenCalled();
  });
});
