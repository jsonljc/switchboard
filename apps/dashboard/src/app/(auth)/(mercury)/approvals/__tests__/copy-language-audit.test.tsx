import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { visibleText } from "./visible-text";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { organizationId: "org-1", principalId: "p-1" },
    status: "authenticated",
  }),
}));
vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => false }));
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(""),
}));

import { ApprovalsPage } from "../approvals-page";
import { DispatchBanner } from "../components/detail/dispatch-banner";
import { ActionDrawer } from "../components/detail/action-drawer";
import { APPROVALS_FIXTURES } from "../fixtures";

const DENYLIST = [
  /\bbinding\b/i,
  /\benvelope\b/i,
  /\bsha256\b/i,
  /\blifecycle\b/i,
  /\bdispatch(?:ing|ed)?\b/i,
  /\bidempoten/i,
  /\bexecutable work unit\b/i,
  /\bfrozen for\b/i,
  /\bcartridge\b/i,
];

function assertNoBannedVocab(scope: string) {
  const text = visibleText();
  for (const pattern of DENYLIST) {
    expect(text, `[${scope}] denylist match: ${pattern}`).not.toMatch(pattern);
  }
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ApprovalsPage />
    </QueryClientProvider>,
  );
}

describe("Copy-language denylist", () => {
  it("idle queue + detail contains no banned vocabulary", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
    assertNoBannedVocab("idle");
  });

  it("DispatchBanner kind=approved (single approver) has no banned vocab", () => {
    render(<DispatchBanner kind="approved" agentName="Alex" />);
    assertNoBannedVocab("dispatch-approved");
  });

  it("DispatchBanner kind=patched has no banned vocab", () => {
    render(<DispatchBanner kind="patched" agentName="Alex" />);
    assertNoBannedVocab("dispatch-patched");
  });

  it("DispatchBanner quorum-waiting has no banned vocab", () => {
    render(<DispatchBanner kind="approved" agentName="Alex" awaitingQuorum={2} />);
    assertNoBannedVocab("dispatch-quorum");
  });

  it("DispatchBanner kind=rejected has no banned vocab", () => {
    render(<DispatchBanner kind="rejected" agentName="Alex" />);
    assertNoBannedVocab("dispatch-rejected");
  });

  it("ActionDrawer recovery state has no banned vocab", () => {
    const recoveryRow = APPROVALS_FIXTURES.find((r) => r.id === "apr_e0c4a5")!;
    render(
      <ActionDrawer
        row={recoveryRow}
        now={Date.now()}
        principalId="p-1"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    assertNoBannedVocab("recovery");
  });

  it("ActionDrawer expired state has no banned vocab", () => {
    const lowRow = APPROVALS_FIXTURES.find((r) => r.id === "apr_55ab10")!;
    const expired = { ...lowRow, expiresAt: new Date(Date.now() - 60_000).toISOString() };
    render(
      <ActionDrawer
        row={expired}
        now={Date.now()}
        principalId="p-1"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    assertNoBannedVocab("expired");
  });

  it("ActionDrawer error (409) state has no banned vocab", () => {
    const lowRow = APPROVALS_FIXTURES.find((r) => r.id === "apr_55ab10")!;
    render(
      <ActionDrawer
        row={lowRow}
        now={Date.now()}
        principalId="p-1"
        error={{ status: 409 }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    assertNoBannedVocab("error-409");
  });
});
