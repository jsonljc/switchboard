/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

/** Match text that may be split across child elements by checking the
 *  element's full textContent. Restricted to the deepest matching element
 *  so we don't match every ancestor.
 *  Workaround for split text nodes like `<span>showing<strong>20</strong> of 20</span>`. */
function hasNormalisedText(needle: string) {
  return (_content: string, node: Element | null) => {
    if (!node) return false;
    const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!text.includes(needle)) return false;
    const childMatches = Array.from(node.children).some((child) =>
      (child.textContent?.replace(/\s+/g, " ").trim() ?? "").includes(needle),
    );
    return !childMatches;
  };
}
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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RightDrawerProvider>
        <PipelinePage />
      </RightDrawerProvider>
    </QueryClientProvider>,
  );
}

describe("PipelinePage (fixture mode)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders all 8 stage columns with their labels", async () => {
    renderPage();
    for (const label of [
      "Interested",
      "Qualified",
      "Quoted",
      "Booked",
      "Showed",
      "Won",
      "Lost",
      "Nurturing",
    ]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  it("renders the page title and Mercury Tools eyebrow", async () => {
    renderPage();
    expect(await screen.findByText("Opportunity pipeline")).toBeInTheDocument();
    expect(screen.getByText("Mercury Tools · Pipeline")).toBeInTheDocument();
  });

  it("shows '20 opportunities' aggregate before filtering", async () => {
    renderPage();
    expect(await screen.findByText(hasNormalisedText("showing 20 of 20"))).toBeInTheDocument();
  });

  it("filters by qualified-only and updates header tile with (filtered) suffix", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(hasNormalisedText("showing 20 of 20"));
    await user.click(screen.getByLabelText(/Qualified only/i));
    // 14 of 20 rows in the fixture have qualificationComplete=true.
    await waitFor(() =>
      expect(screen.getByText(hasNormalisedText("showing 14 of 20"))).toBeInTheDocument(),
    );
    expect(screen.getAllByText(/\(filtered\)/i).length).toBeGreaterThan(0);
  });

  it("clears filters when Clear filters is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(hasNormalisedText("showing 20 of 20"));
    await user.click(screen.getByLabelText(/Qualified only/i));
    await user.click(screen.getByText("Clear filters"));
    expect(screen.getByText(hasNormalisedText("showing 20 of 20"))).toBeInTheDocument();
  });

  it("shows per-column empty states (not whole-board empty) when all rows are filtered out", async () => {
    // Acceptance criterion §13.10: whole-board empty uses ORG rows, not filtered.
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Opportunity pipeline");

    await user.click(screen.getByText("24h"));
    await user.click(screen.getByLabelText(/Qualified only/i));

    expect(screen.getByText("Interested")).toBeInTheDocument();
    expect(screen.queryByText(/No deals in your pipeline yet/i)).not.toBeInTheDocument();
  });

  it("renders lost-stage cards with muted value (no won pill)", async () => {
    // Acceptance criterion §13.8.
    renderPage();
    const lostCard = await screen.findByText("CoolSculpting · abdomen");
    const card = lostCard.closest("a")!;
    expect(card.querySelector('[data-tone="won"]')).toBeNull();
  });
});
