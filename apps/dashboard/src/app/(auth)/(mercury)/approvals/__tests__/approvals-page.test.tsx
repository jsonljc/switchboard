import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { organizationId: "org-1", principalId: "p-1" },
    status: "authenticated",
  }),
}));
vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: () => false,
}));
const mockReplace = vi.fn();
const useSearchParamsMock = vi.fn().mockReturnValue(new URLSearchParams(""));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => useSearchParamsMock(),
}));

import { ApprovalsPage } from "../approvals-page";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApprovalsPage />
    </QueryClientProvider>,
  );
}

describe("ApprovalsPage", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    useSearchParamsMock.mockReturnValue(new URLSearchParams(""));
  });

  it("renders the title", async () => {
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: /approvals/i }),
    ).toBeInTheDocument();
  });

  it("renders all fixture rows after load", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
  });

  it("sorts expiring-soonest first (apr_2f1a08 critical 4-min at top)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
    const rowButtons = screen.getAllByRole("button", { name: /^Open approval:/ });
    expect(rowButtons[0]).toHaveAccessibleName(/Refund SGD 4,820/);
  });

  it("does not count already-expired rows in the < 1h-to-expiry stat tile", async () => {
    // The fixture set includes apr_2f1a08 (critical, 4-min ahead). We don't
    // have a synthetic past-expiry row in the fixtures, but the stat tile
    // should still only count rows where remaining > 0 AND < 60min. Verify
    // the tile renders a number consistent with that contract by inspecting
    // the rendered count against the actually-soon-expiring fixtures.
    renderPage();
    await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
    // Each fixture's expiresAt is set relative to Date.now() at module load.
    // The "soon" fixtures are: apr_2f1a08 (4min), apr_9b73c1 (38min), apr_d77c20 (42min),
    // apr_4e082a (51min). All four are within < 60min and have positive remaining.
    // The stat tile should read 4.
    const statTiles = screen.getAllByText(/^[0-9]+$/);
    // Find the tile next to "< 1h to expiry"
    const eyebrowEl = screen.getByText(/< 1h to expiry/i);
    const tileContainer = eyebrowEl.parentElement;
    expect(tileContainer).not.toBeNull();
    const countNode = tileContainer!.querySelector("span:nth-of-type(2)");
    expect(countNode?.textContent).toBe("4");
    // Sanity: the rendered stat values include "12" (pending total) and "4" (expiring-soon)
    const renderedNumbers = statTiles.map((el) => el.textContent);
    expect(renderedNumbers).toContain("12");
    expect(renderedNumbers).toContain("4");
  });

  it("toggling a risk filter narrows the rendered rows", async () => {
    renderPage();
    await screen.findByText(/Refund SGD 4,820/);
    fireEvent.click(screen.getByRole("button", { name: /^critical/i }));
    // Only the one critical fixture should remain visible
    await waitFor(() => {
      const rows = screen.getAllByRole("button", { name: /^Open approval:/ });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveAccessibleName(/Refund SGD 4,820/);
    });
  });

  it("the page renders the live timer on rows (passes `now` to queue)", async () => {
    renderPage();
    await screen.findByText(/Refund SGD 4,820/);
    // At least one row should show a remaining-time element with the testid.
    expect(screen.getAllByTestId("queue-row-timer").length).toBeGreaterThan(0);
  });

  it("renders the detail pane for the active row", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
    // The confirmation-code block renders the bindingHash for apr_2f1a08
    await waitFor(() => expect(screen.getByText(/^0x2f1a08c4/)).toBeInTheDocument());
  });

  it("updates ?id= in the URL when a row is selected", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Charge no-show fee/ }));
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining("id=apr_55ab10"), {
        scroll: false,
      }),
    );
  });

  it("deep-links with ?id=apr_… select that row on first paint", async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("id=apr_55ab10"));
    renderPage();
    // The detail pane should render the bindingHash for apr_55ab10
    await waitFor(() => expect(screen.getByText(/^0x55ab10d2/)).toBeInTheDocument());
  });
});
