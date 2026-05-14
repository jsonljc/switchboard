/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

describe("Pipeline drag and drop", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves a card to a new column and shows a success toast", async () => {
    renderPage();
    const card = await screen.findByText("Hydrafacial · single session");
    const cardLink = card.closest("a")!;
    const qualifiedColumn = screen.getByText("Qualified").closest("section")!;

    // jsdom does not implement full HTML5 DnD — synthesise a DataTransfer-like
    // object so onDragStart/onDrop handlers receive what they expect.
    const dataTransfer = { effectAllowed: "", setData: vi.fn(), getData: () => "opp_001" };
    fireEvent.dragStart(cardLink, { dataTransfer });
    fireEvent.dragOver(qualifiedColumn, { dataTransfer });
    fireEvent.drop(qualifiedColumn, { dataTransfer });
    fireEvent.dragEnd(cardLink, { dataTransfer });

    await waitFor(() => expect(screen.getByText(/Moved Jia to Qualified\./)).toBeInTheDocument());
  });

  it("treats drop on the current column as a no-op", async () => {
    renderPage();
    const card = await screen.findByText("Hydrafacial · single session");
    const cardLink = card.closest("a")!;
    const interestedColumn = screen.getByText("Interested").closest("section")!;

    const dataTransfer = { effectAllowed: "", setData: vi.fn(), getData: () => "opp_001" };
    fireEvent.dragStart(cardLink, { dataTransfer });
    fireEvent.drop(interestedColumn, { dataTransfer });
    fireEvent.dragEnd(cardLink, { dataTransfer });

    expect(screen.queryByText(/Moved Jia/i)).not.toBeInTheDocument();
  });
});
