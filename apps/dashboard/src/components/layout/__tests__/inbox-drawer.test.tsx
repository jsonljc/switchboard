import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ---------- Stable top-level mocks (no resetModules / doMock anywhere) ----------

// Feed: a mutable variable that tests reassign before render/rerender.
let mockFeed: {
  data:
    | { decisions: unknown[]; counts: { total: number; approval: number; handoff: number } }
    | undefined;
  isLoading: boolean;
  isError: boolean;
} = {
  data: { decisions: [], counts: { total: 3, approval: 2, handoff: 1 } },
  isLoading: false,
  isError: false,
};
vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: () => mockFeed,
}));

// Tenant: a mutable variable, mocked at the hook layer (not next-auth) so the
// component's call to useTenantContext() flips behavior directly.
let mockTenant: { orgId: string; keys: unknown } | null = {
  orgId: "org-1",
  keys: {},
};
vi.mock("@/hooks/use-query-keys", () => ({
  useTenantContext: () => mockTenant,
}));

// Dispatch: a stable spy that tests inspect.
const dispatchMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/decisions/dispatch-action", () => ({
  dispatchDecisionAction: (...args: unknown[]) => dispatchMock(...args),
}));

// DecisionCard: a single mock that exposes folio.kindLabel as a data attr and
// surfaces onPrimary / onSecondary as test-id'd buttons. Used by Tasks 5–7.
vi.mock("@/components/decisions/decision-card", () => ({
  DecisionCard: ({
    folio,
    serifSentence,
    onPrimary,
    onSecondary,
  }: {
    folio: { kindLabel: string };
    serifSentence?: string;
    onPrimary?: () => void;
    onSecondary?: () => void;
  }) => (
    <article data-testid="mock-decision-card" data-folio-kind-label={folio.kindLabel}>
      <p>{serifSentence}</p>
      <button data-testid="card-primary" onClick={onPrimary}>
        primary
      </button>
      <button data-testid="card-secondary" onClick={onSecondary}>
        secondary
      </button>
    </article>
  ),
}));

// ConfirmSheet: expose the confirm/cancel buttons with stable test-ids so the
// risk-gate tests can interact with the confirm step.
vi.mock("@/components/decisions/swipe-decision-card", () => ({
  ConfirmSheet: ({
    open,
    onCancel,
    onConfirm,
  }: {
    open: boolean;
    agentName: string;
    summary: string;
    affirmativeLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="confirm-sheet" data-testid="confirm-sheet">
        <button data-testid="confirm-cancel" onClick={onCancel}>
          Not now
        </button>
        <button data-testid="confirm-affirm" onClick={onConfirm}>
          Confirm
        </button>
      </div>
    ) : null,
}));

import { InboxDrawer } from "../inbox-drawer";
import { RightDrawerProvider } from "../right-drawer-context";

beforeEach(() => {
  // Reset mutable mock state to the default tenant-present, empty-feed shape.
  mockTenant = { orgId: "org-1", keys: {} };
  mockFeed = {
    data: { decisions: [], counts: { total: 3, approval: 2, handoff: 1 } },
    isLoading: false,
    isError: false,
  };
  dispatchMock.mockReset();
  dispatchMock.mockResolvedValue(undefined);
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <RightDrawerProvider>{children}</RightDrawerProvider>
    </QueryClientProvider>
  );
}

describe("InboxDrawer — header DOM contract", () => {
  it("preserves the folio-link trigger DOM (pip + label + separator + count)", () => {
    mockFeed = {
      data: { decisions: [], counts: { total: 3, approval: 2, handoff: 1 } },
      isLoading: false,
      isError: false,
    };
    const { container } = render(<InboxDrawer />, { wrapper });

    const trigger = container.querySelector("button.folio-link");
    expect(trigger).not.toBeNull();
    expect(trigger?.querySelector("span.pip")).not.toBeNull();
    expect(trigger?.textContent).toContain("Inbox");
    expect(trigger?.textContent).toContain("·");
    const num = trigger?.querySelector("span.num");
    expect(num?.textContent).toBe("3");
  });
});

describe("InboxDrawer — trigger aria-label", () => {
  it("reads 'Inbox, empty' when total is 0", () => {
    mockFeed = {
      data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
      isLoading: false,
      isError: false,
    };
    render(<InboxDrawer />, { wrapper });
    expect(screen.getByRole("button", { name: "Inbox, empty" })).toBeInTheDocument();
  });

  it("reads 'Inbox, 1 item' when total is 1", () => {
    mockFeed = {
      data: { decisions: [], counts: { total: 1, approval: 1, handoff: 0 } },
      isLoading: false,
      isError: false,
    };
    render(<InboxDrawer />, { wrapper });
    expect(screen.getByRole("button", { name: "Inbox, 1 item" })).toBeInTheDocument();
  });

  it("reads 'Inbox, 3 items' when total is 3", () => {
    mockFeed = {
      data: { decisions: [], counts: { total: 3, approval: 2, handoff: 1 } },
      isLoading: false,
      isError: false,
    };
    render(<InboxDrawer />, { wrapper });
    expect(screen.getByRole("button", { name: "Inbox, 3 items" })).toBeInTheDocument();
  });
});

describe("InboxDrawer — tenant-null trigger", () => {
  it("renders the trigger disabled when tenant context is null", async () => {
    mockTenant = null;
    mockFeed = {
      data: undefined,
      isLoading: false,
      isError: false,
    };
    const user = userEvent.setup();
    render(<InboxDrawer />, { wrapper });

    const trigger = screen.getByRole("button", { name: "Inbox, empty" });
    expect(trigger).toBeDisabled();

    // Clicking a disabled button must not open the dialog.
    await user.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("InboxDrawer — accessibility", () => {
  it("opens a dialog with accessible name 'Inbox' when the trigger is clicked", async () => {
    const user = userEvent.setup();
    mockFeed = {
      data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
      isLoading: false,
      isError: false,
    };
    render(<InboxDrawer />, { wrapper });
    await user.click(screen.getByRole("button", { name: /^Inbox/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Inbox");
  });
});

describe("InboxDrawer — list states", () => {
  it("renders 'Reading your inbox…' when the feed is loading and has no cached data", async () => {
    const user = userEvent.setup();
    mockFeed = {
      data: undefined,
      isLoading: true,
      isError: false,
    };
    render(<InboxDrawer />, { wrapper });
    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    expect(await screen.findByText(/Reading your inbox/i)).toBeInTheDocument();
  });

  it("renders 'Couldn't load your inbox.' when the feed errored", async () => {
    const user = userEvent.setup();
    mockFeed = {
      data: undefined,
      isLoading: false,
      isError: true,
    };
    render(<InboxDrawer />, { wrapper });
    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    expect(await screen.findByText(/Couldn't load your inbox\./i)).toBeInTheDocument();
  });

  it("renders the editorial empty-state copy when total is 0", async () => {
    const user = userEvent.setup();
    mockFeed = {
      data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
      isLoading: false,
      isError: false,
    };
    render(<InboxDrawer />, { wrapper });
    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    expect(
      await screen.findByText(
        /You're caught up across your team\. I'll write again when something needs you\./i,
      ),
    ).toBeInTheDocument();
  });
});

describe("InboxDrawer — populated list", () => {
  it("renders one DecisionCard per item with the agent name prefix and accent variable", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFeed = {
      data: {
        decisions: [
          {
            id: "approval:rec-1",
            kind: "approval",
            orgId: "org-1",
            agentKey: "alex",
            humanSummary: "A new lead just walked in.",
            presentation: {
              primaryLabel: "Reply",
              secondaryLabel: "Skip",
              dismissLabel: "Dismiss",
              dataLines: [],
            },
            urgencyScore: 80,
            createdAt: now,
            threadHref: null,
            sourceRef: { kind: "approval", sourceId: "rec-1" },
            meta: { contactName: "Sam Lee", riskLevel: "low" },
          },
          {
            id: "handoff:hand-1",
            kind: "handoff",
            orgId: "org-1",
            agentKey: "riley",
            humanSummary: "Conversation needs a human.",
            presentation: {
              primaryLabel: "Take over",
              secondaryLabel: "Resolve",
              dismissLabel: "Dismiss",
              dataLines: [],
            },
            urgencyScore: 60,
            createdAt: now,
            threadHref: "/contacts/c1/conversations/t1",
            sourceRef: { kind: "handoff", sourceId: "hand-1" },
            meta: { contactName: "Jay Park" },
          },
        ],
        counts: { total: 2, approval: 1, handoff: 1 },
      },
      isLoading: false,
      isError: false,
    };

    render(<InboxDrawer />, { wrapper });
    await user.click(screen.getByRole("button", { name: /^Inbox/ }));

    const cards = await screen.findAllByTestId("mock-decision-card");
    expect(cards).toHaveLength(2);
    // Assert the drawer-added prefix only; the suffix is mapToDecisionCard's
    // contract, tested elsewhere. This isolates C1's responsibility.
    expect(cards[0].getAttribute("data-folio-kind-label")).toContain("Alex ·");
    expect(cards[1].getAttribute("data-folio-kind-label")).toContain("Riley ·");

    const list = screen.getByTestId("inbox-list");
    const wrappers = list.querySelectorAll(".inbox-item");
    expect(wrappers).toHaveLength(2);
    expect(wrappers[0].getAttribute("data-agent")).toBe("alex");
    expect(wrappers[1].getAttribute("data-agent")).toBe("riley");

    const alexAccent = (wrappers[0] as HTMLElement).style.getPropertyValue("--inbox-agent-accent");
    const rileyAccent = (wrappers[1] as HTMLElement).style.getPropertyValue("--inbox-agent-accent");
    expect(alexAccent).toBe("hsl(20 90% 55%)");
    expect(rileyAccent).toBe("hsl(15 45% 50%)");
  });
});

describe("InboxDrawer — action dispatch", () => {
  it("invokes dispatchDecisionAction with the per-item agentKey on primary click", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFeed = {
      data: {
        decisions: [
          {
            id: "handoff:hand-1",
            kind: "handoff",
            orgId: "org-1",
            agentKey: "riley",
            humanSummary: "Conversation needs a human.",
            presentation: {
              primaryLabel: "Take over",
              secondaryLabel: "Resolve",
              dismissLabel: "Dismiss",
              dataLines: [],
            },
            urgencyScore: 60,
            createdAt: now,
            threadHref: null,
            sourceRef: { kind: "handoff", sourceId: "hand-1" },
            meta: { contactName: "Jay Park" },
          },
        ],
        counts: { total: 1, approval: 0, handoff: 1 },
      },
      isLoading: false,
      isError: false,
    };

    render(<InboxDrawer />, { wrapper });
    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    await user.click(await screen.findByTestId("card-primary"));

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const callArgs = dispatchMock.mock.calls[0];
    expect(callArgs[0]).toEqual({ kind: "handoff", sourceId: "hand-1" });
    expect(callArgs[1]).toBe("primary");
    expect(callArgs[3]).toMatchObject({
      orgId: "org-1",
      agentKey: "riley",
    });
  });
});

describe("InboxDrawer — auto-close on inbox-zero", () => {
  function makeOneItemFeed() {
    const now = new Date().toISOString();
    return {
      data: {
        decisions: [
          {
            id: "approval:rec-1",
            kind: "approval",
            orgId: "org-1",
            agentKey: "alex",
            humanSummary: "Lead.",
            presentation: {
              primaryLabel: "Reply",
              secondaryLabel: "Skip",
              dismissLabel: "Dismiss",
              dataLines: [],
            },
            urgencyScore: 80,
            createdAt: now,
            threadHref: null,
            sourceRef: { kind: "approval", sourceId: "rec-1" },
            // Low-risk contract — single tap MUST commit directly (no confirm gate).
            meta: {
              riskContract: {
                riskLevel: "low",
                externalEffect: false,
                financialEffect: false,
                clientFacing: false,
                requiresConfirmation: false,
              },
            },
          },
        ],
        counts: { total: 1, approval: 1, handoff: 0 },
      },
      isLoading: false,
      isError: false,
    };
  }
  const emptyFeed = {
    data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
    isLoading: false,
    isError: false,
  };

  it("closes the drawer when count hits 0 AFTER a successful in-session action", async () => {
    const user = userEvent.setup();
    mockFeed = makeOneItemFeed();
    const { rerender } = render(<InboxDrawer />, { wrapper });

    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.click(await screen.findByTestId("card-primary"));
    // The dispatcher promise resolves on the next microtask; wait for the spy
    // so we know the in-session ref has flipped before the rerender.
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));

    // Simulate the post-dispatch refetch: count goes to 0.
    mockFeed = emptyFeed;
    rerender(<InboxDrawer />);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("stays open when count drops to 0 without a successful in-session action", async () => {
    const user = userEvent.setup();
    mockFeed = makeOneItemFeed();
    const { rerender } = render(<InboxDrawer />, { wrapper });

    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // Another surface clears the inbox; user did not act inside the drawer.
    mockFeed = emptyFeed;
    rerender(<InboxDrawer />);

    // Give effects a tick to run, then assert the drawer stayed open.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("resets the in-session-action flag when the drawer closes manually", async () => {
    const user = userEvent.setup();
    // Dispatcher resolves but feed still shows the item — drawer stays open after action.
    mockFeed = makeOneItemFeed();
    const { rerender } = render(<InboxDrawer />, { wrapper });

    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    await user.click(await screen.findByTestId("card-primary"));
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // User closes manually via Escape — Radix listens at document, userEvent fires it correctly.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Reopen with the item still present.
    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // Feed drops to 0 without acting — drawer must stay open (ref reset on close).
    mockFeed = emptyFeed;
    rerender(<InboxDrawer />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("InboxDrawer — risk gate (P1-B coherence)", () => {
  const now = new Date().toISOString();

  /** Build an approval decision with the given riskContract. */
  function makeApprovalFeed(riskContract?: {
    riskLevel: "low" | "medium" | "high";
    externalEffect: boolean;
    financialEffect: boolean;
    clientFacing: boolean;
    requiresConfirmation: boolean;
  }) {
    return {
      data: {
        decisions: [
          {
            id: "approval:rec-gate",
            kind: "approval",
            orgId: "org-1",
            agentKey: "riley",
            humanSummary: "Move $5 000 to Meta Ads.",
            presentation: {
              primaryLabel: "Approve",
              secondaryLabel: "Skip",
              dismissLabel: "Dismiss",
              dataLines: [],
            },
            urgencyScore: 90,
            createdAt: now,
            threadHref: null,
            sourceRef: { kind: "approval", sourceId: "rec-gate" },
            meta: { riskContract },
          },
        ],
        counts: { total: 1, approval: 1, handoff: 0 },
      },
      isLoading: false,
      isError: false,
    };
  }

  it("does NOT commit when primary is tapped on a high-risk approval — opens confirm instead", async () => {
    const user = userEvent.setup();
    mockFeed = makeApprovalFeed({
      riskLevel: "high",
      externalEffect: true,
      financialEffect: true,
      clientFacing: false,
      requiresConfirmation: true,
    });
    render(<InboxDrawer />, { wrapper });

    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    await user.click(await screen.findByTestId("card-primary"));

    // dispatch must NOT have been called — the confirm gate must intercept.
    expect(dispatchMock).not.toHaveBeenCalled();
    // The confirm sheet must be visible.
    expect(await screen.findByTestId("confirm-sheet")).toBeInTheDocument();
  });

  it("does NOT commit when primary is tapped on an approval with no riskContract (missing = unsafe)", async () => {
    const user = userEvent.setup();
    mockFeed = makeApprovalFeed(undefined); // no riskContract → needsConfirm = true
    render(<InboxDrawer />, { wrapper });

    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    await user.click(await screen.findByTestId("card-primary"));

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId("confirm-sheet")).toBeInTheDocument();
  });

  it("commits ONLY after the confirm affirmative on a needsConfirm approval", async () => {
    const user = userEvent.setup();
    mockFeed = makeApprovalFeed({
      riskLevel: "high",
      externalEffect: false,
      financialEffect: true,
      clientFacing: false,
      requiresConfirmation: true,
    });
    render(<InboxDrawer />, { wrapper });

    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    await user.click(await screen.findByTestId("card-primary"));

    // Before confirm — no dispatch.
    expect(dispatchMock).not.toHaveBeenCalled();

    // Fire the affirmative button via fireEvent to bypass pointer-events scrim
    // from the Radix Sheet overlay (the ConfirmSheet is rendered outside the
    // Sheet but pointer-events from Radix may still affect descendants).
    const affirmBtn = await screen.findByTestId("confirm-affirm");
    fireEvent.click(affirmBtn);

    await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));
    const callArgs = dispatchMock.mock.calls[0];
    expect(callArgs[0]).toEqual({ kind: "approval", sourceId: "rec-gate" });
    expect(callArgs[1]).toBe("primary");
  });

  it("cancels without committing when 'Not now' is tapped in the confirm sheet", async () => {
    const user = userEvent.setup();
    mockFeed = makeApprovalFeed({
      riskLevel: "high",
      externalEffect: false,
      financialEffect: true,
      clientFacing: false,
      requiresConfirmation: true,
    });
    render(<InboxDrawer />, { wrapper });

    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    await user.click(await screen.findByTestId("card-primary"));
    expect(await screen.findByTestId("confirm-sheet")).toBeInTheDocument();

    // fireEvent to bypass pointer-events from the Radix Sheet overlay scrim.
    fireEvent.click(screen.getByTestId("confirm-cancel"));

    // Confirm sheet dismissed, dispatch never called.
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirm-sheet")).not.toBeInTheDocument();
  });

  it("commits immediately (no confirm) when primary is tapped on a low-risk approval", async () => {
    const user = userEvent.setup();
    mockFeed = makeApprovalFeed({
      riskLevel: "low",
      externalEffect: false,
      financialEffect: false,
      clientFacing: false,
      requiresConfirmation: false,
    });
    render(<InboxDrawer />, { wrapper });

    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    await user.click(await screen.findByTestId("card-primary"));

    // Low-risk: dispatch fires directly, no confirm sheet.
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("confirm-sheet")).not.toBeInTheDocument();
    const callArgs = dispatchMock.mock.calls[0];
    expect(callArgs[0]).toEqual({ kind: "approval", sourceId: "rec-gate" });
    expect(callArgs[1]).toBe("primary");
  });
});
