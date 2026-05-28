import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => false }));
vi.mock("@/hooks/use-query-keys", () => ({ useScopedQueryKeys: () => null }));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({ data: undefined, isLoading: false }),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, prefetch: vi.fn() }),
}));

// AgentPanel is tested independently; mock it so ResultsPage wiring tests stay focused.
vi.mock("@/components/agent-panel/agent-panel", () => ({
  AgentPanel: ({
    agentKey,
    open,
    onOpenChange,
    onOpenDecision,
    onActivate,
  }: {
    agentKey: string;
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onOpenDecision?: () => void;
    onActivate?: () => void;
  }) =>
    open ? (
      <div role="dialog" data-testid={`mock-agent-panel-${agentKey}`}>
        <button onClick={() => onOpenChange(false)} data-testid="mock-panel-close">
          Close
        </button>
        <button onClick={onOpenDecision} data-testid="mock-open-decision">
          Open decision
        </button>
        <button onClick={onActivate} data-testid="mock-activate">
          Activate
        </button>
      </div>
    ) : null,
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

describe("ResultsPage — agent chip opens agent panel", () => {
  it("panel is absent before interaction", () => {
    mount();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking the Riley chip opens the riley agent panel", () => {
    mount();
    const rileyCfg = screen.getByRole("button", { name: /open riley panel/i });
    fireEvent.click(rileyCfg);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("mock-agent-panel-riley")).toBeInTheDocument();
  });

  it("clicking the Alex chip opens the alex agent panel", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /open alex panel/i }));
    expect(screen.getByTestId("mock-agent-panel-alex")).toBeInTheDocument();
  });

  it("clicking the Mira chip opens the mira agent panel (honest not-set-up panel)", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /open mira panel/i }));
    expect(screen.getByTestId("mock-agent-panel-mira")).toBeInTheDocument();
  });

  it("closing the panel clears it", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /open alex panel/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-panel-close"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("onOpenDecision navigates to /inbox", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /open alex panel/i }));
    fireEvent.click(screen.getByTestId("mock-open-decision"));
    expect(pushMock).toHaveBeenCalledWith("/inbox");
  });

  it("onActivate navigates to /settings/channels", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /open alex panel/i }));
    fireEvent.click(screen.getByTestId("mock-activate"));
    expect(pushMock).toHaveBeenCalledWith("/settings/channels");
  });
});
