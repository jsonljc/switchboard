import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ActivityTrail } from "../activity-trail";
import type { AuditEntryResponse } from "@/hooks/use-audit";

vi.mock("@/hooks/use-audit");

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

function makeEntry(overrides: Partial<AuditEntryResponse> = {}): AuditEntryResponse {
  return {
    id: "ev-1",
    eventType: "approval.granted",
    timestamp: new Date().toISOString(),
    actorType: "agent",
    actorId: "alex",
    entityType: "approval",
    entityId: "ap-1",
    riskCategory: "low",
    summary: "Approved campaign launch",
    snapshot: {},
    envelopeId: null,
    ...overrides,
  };
}

async function mockUseAudit(opts: {
  data?: unknown;
  isLoading?: boolean;
  error?: Error | null;
  refetch?: () => void;
}) {
  const mod = await import("@/hooks/use-audit");
  vi.mocked(mod.useAudit).mockReturnValue({
    data: opts.data,
    isLoading: opts.isLoading ?? false,
    error: opts.error ?? null,
    refetch: opts.refetch ?? vi.fn(),
  } as never);
}

describe("ActivityTrail", () => {
  it("renders skeleton while loading", async () => {
    await mockUseAudit({ isLoading: true });
    render(<ActivityTrail />, { wrapper });
    expect(screen.getByLabelText(/loading activity/i)).toBeInTheDocument();
  });

  it("renders error state with retry that calls refetch", async () => {
    const refetch = vi.fn();
    await mockUseAudit({ error: new Error("boom"), refetch });
    render(<ActivityTrail />, { wrapper });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders empty state when entries is empty", async () => {
    await mockUseAudit({ data: { entries: [], total: 0 } });
    render(<ActivityTrail />, { wrapper });
    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
  });

  it("renders rows showing the summary field when entries are present", async () => {
    await mockUseAudit({
      data: {
        entries: [
          makeEntry({
            id: "ev-a",
            eventType: "approval.granted",
            summary: "Approved Aurora Q3 launch",
          }),
          makeEntry({
            id: "ev-b",
            eventType: "escalation.resolved",
            summary: "Escalation handled by Alex",
          }),
        ],
        total: 2,
      },
    });
    render(<ActivityTrail />, { wrapper });
    expect(screen.getByText("Approved Aurora Q3 launch")).toBeInTheDocument();
    expect(screen.getByText("Escalation handled by Alex")).toBeInTheDocument();
    // Ensure we did NOT fall back to the slug.
    expect(screen.queryByText(/^approval granted$/i)).not.toBeInTheDocument();
  });

  it("falls back to humanized eventType when summary is empty", async () => {
    await mockUseAudit({
      data: {
        entries: [
          makeEntry({
            id: "ev-c",
            eventType: "approval.granted",
            summary: "",
          }),
        ],
        total: 1,
      },
    });
    render(<ActivityTrail />, { wrapper });
    expect(screen.getByText(/approval granted|granted/i)).toBeInTheDocument();
  });

  it("each row's arrow link points to /conversations", async () => {
    await mockUseAudit({
      data: {
        entries: [makeEntry({ id: "ev-d", summary: "Some recent event" })],
        total: 1,
      },
    });
    render(<ActivityTrail />, { wrapper });
    const arrow = screen.getByRole("link", { name: /→/ });
    expect(arrow).toHaveAttribute("href", "/conversations");
  });
});
