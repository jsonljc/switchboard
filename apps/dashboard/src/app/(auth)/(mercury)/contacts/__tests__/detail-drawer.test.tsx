/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { RightDrawerProvider } from "@/components/layout/right-drawer-context";
import { PipelinePage } from "../pipeline-page";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    opportunities: { board: () => ["org_test", "opportunities", "board"] as const },
  }),
}));
vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => false }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...rest
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RightDrawerProvider>
        <PipelinePage />
      </RightDrawerProvider>
    </QueryClientProvider>,
  );
}

describe("DetailDrawer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens when a card is clicked and renders the service name + contact name", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = await screen.findByText("Hydrafacial · single session");
    await user.click(card);
    // Drawer (Radix Dialog) appears as role="dialog"; scope queries to it so we
    // don't collide with the same contact name rendered on the card.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Jia Min Tan")).toBeInTheDocument();
    expect(within(dialog).getByText("Hydrafacial · single session")).toBeInTheDocument();
  });

  it("does NOT show the revenue hint on a Won card with revenue > 0", async () => {
    const user = userEvent.setup();
    renderPage();
    const wonCard = await screen.findByText("Profhilo · session 1 of 2");
    await user.click(wonCard);
    expect(screen.queryByText(/Recorded as won/i)).not.toBeInTheDocument();
  });

  it("renders 'Open contact →' linking to /contacts/[contactId]", async () => {
    const user = userEvent.setup();
    renderPage();
    const card = await screen.findByText("Hydrafacial · single session");
    await user.click(card);
    const openContact = await screen.findByText("Open contact →");
    expect(openContact.closest("a")).toHaveAttribute("href", "/contacts/c_001");
  });

  it("changes a card's stage via the drawer <select> with no mouse drag", async () => {
    // Acceptance criterion §13.6.
    //
    // NOTE: PipelinePage's drawer onStageChange currently calls
    // `transition.mutate(input)` with no success callback, so no toast is
    // surfaced for drawer-driven moves (only drag-and-drop moves toast).
    // This is a real gap vs §13.6 — flagged but not papered over.
    // We assert the user-visible side effect that DOES happen today: the
    // mutation's optimistic onMutate updates the React Query cache so the
    // drawer's <select value> reflects the new stage immediately.
    const user = userEvent.setup();
    renderPage();
    const card = await screen.findByText("Hydrafacial · single session");
    await user.click(card);
    const select = (await screen.findByLabelText(/Change stage/i)) as HTMLSelectElement;
    expect(select.value).toBe("interested");
    await user.selectOptions(select, "qualified");
    await waitFor(() => {
      const refreshed = screen.getByLabelText(/Change stage/i) as HTMLSelectElement;
      expect(refreshed.value).toBe("qualified");
    });
  });
});
