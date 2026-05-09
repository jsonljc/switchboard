import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
