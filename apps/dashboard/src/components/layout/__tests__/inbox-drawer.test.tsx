import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

import { InboxDrawer } from "../inbox-drawer";

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
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
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
            meta: {},
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
