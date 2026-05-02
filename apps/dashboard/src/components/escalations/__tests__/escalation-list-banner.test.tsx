import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EscalationList } from "../escalation-list";

/**
 * DC-23 — branched post-reply banner copy on /escalations.
 *
 * The previous banner read "Your reply has been saved. It will be included in
 * the conversation when the customer sends their next message...", which was
 * factually false: the upstream API only returns 200 after
 * `agentNotifier.sendProactive()` succeeds. These tests pin both branches
 * (200 success, 502 channel-delivery-failure) so the misleading copy cannot
 * regress.
 */

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { principalId: "p-1", organizationId: "org-1" },
    status: "authenticated",
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const baseEscalation = {
  id: "e-1",
  reason: "Customer asked about pricing tiers",
  conversationSummary: "Sarah from Acme Co asked about enterprise pricing.",
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  slaDeadlineAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  leadSnapshot: { name: "Sarah", channel: "WhatsApp" },
};

function mockListThenReply(replyResponse: {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}) {
  // First fetch: the list query. Subsequent fetches: detail (on expand) + reply.
  mockFetch.mockImplementation((url: string) => {
    if (
      typeof url === "string" &&
      url.includes("/api/dashboard/escalations") &&
      url.endsWith("/reply")
    ) {
      return Promise.resolve({
        ok: replyResponse.ok,
        status: replyResponse.status,
        json: async () => replyResponse.body,
      });
    }
    if (typeof url === "string" && url.match(/\/api\/dashboard\/escalations\/[^/]+$/)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ escalation: baseEscalation, conversationHistory: [] }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ escalations: [baseEscalation] }),
    });
  });
}

describe("EscalationList — DC-23 branched reply banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("on 200 shows truthful success banner referencing channel; misleading next-message copy is gone", async () => {
    mockListThenReply({
      ok: true,
      status: 200,
      body: { escalation: { id: "e-1", status: "released" }, replySent: true },
    });

    render(<EscalationList />, { wrapper });

    // Expand the card.
    await waitFor(() => {
      expect(screen.getByText(/customer asked about pricing/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/customer asked about pricing/i));

    // Type and send.
    const input = await screen.findByPlaceholderText(/type a reply/i);
    fireEvent.change(input, { target: { value: "thanks for reaching out" } });
    const sendBtn = input.parentElement!.querySelector("button");
    expect(sendBtn).not.toBeNull();
    fireEvent.click(sendBtn!);

    // Banner present, channel-aware.
    await waitFor(() => {
      expect(screen.getByText(/reply sent to sarah via whatsapp/i)).toBeInTheDocument();
    });
    // The misleading legacy copy must not be in the DOM.
    expect(
      screen.queryByText(
        /included in the conversation when the customer sends their next message/i,
      ),
    ).toBeNull();
    expect(screen.queryByText(/direct message delivery is coming in a future update/i)).toBeNull();
  });

  it("on 502 shows failure banner; reply text preserved; form not auto-closed", async () => {
    mockListThenReply({
      ok: false,
      status: 502,
      body: {
        escalation: { id: "e-1", status: "released" },
        replySent: false,
        error: "Reply saved but channel delivery failed. Retry or contact customer directly.",
        statusCode: 502,
      },
    });

    render(<EscalationList />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/customer asked about pricing/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/customer asked about pricing/i));

    const input = (await screen.findByPlaceholderText(/type a reply/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "thanks for reaching out" } });
    const sendBtn = input.parentElement!.querySelector("button");
    fireEvent.click(sendBtn!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn't deliver to whatsapp/i);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/channel delivery failed/i);
    // Form preserved: input still has value, still rendered.
    expect((screen.getByPlaceholderText(/type a reply/i) as HTMLInputElement).value).toBe(
      "thanks for reaching out",
    );
  });
});
