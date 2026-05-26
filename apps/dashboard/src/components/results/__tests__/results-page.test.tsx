import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => false }));
vi.mock("@/hooks/use-query-keys", () => ({ useScopedQueryKeys: () => null }));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({ data: undefined, isLoading: false }),
}));

import { ResultsPage } from "../results-page";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ResultsPage />
    </QueryClientProvider>,
  );
}

describe("ResultsPage (fixture mode, default THIS MONTH)", () => {
  it("renders no bare $ anywhere", () => {
    const { container } = mount();
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
  });
  it("leads with booked revenue S$14,720 (dollars, not cents/100)", () => {
    const { container } = mount();
    expect(container.textContent).toContain("S$14,720");
    expect(container.textContent).not.toContain("147.20");
  });
  it("shows Mira 'Not set up yet'", () => {
    mount();
    expect(screen.getByText(/Not set up yet/i)).toBeInTheDocument();
  });
  it("keeps depth collapsed behind 'See the details'", () => {
    mount();
    expect(screen.getByRole("button", { name: /see the details/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
