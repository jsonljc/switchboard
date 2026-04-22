import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrainingShell } from "../training-shell";
import { createEmptyPlaybook } from "@switchboard/schemas";

const mockWebsiteScan = {
  mutate: vi.fn(),
  data: undefined as unknown,
  isPending: false,
  isError: false,
};

vi.mock("@/hooks/use-website-scan", () => ({
  useWebsiteScan: () => mockWebsiteScan,
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("TrainingShell", () => {
  beforeEach(() => {
    mockWebsiteScan.mutate.mockReset();
    mockWebsiteScan.data = undefined;
    mockWebsiteScan.isPending = false;
    mockWebsiteScan.isError = false;
  });

  it("renders chat and playbook panels", () => {
    renderWithProviders(
      <TrainingShell
        playbook={createEmptyPlaybook()}
        onUpdatePlaybook={vi.fn()}
        onAdvance={vi.fn()}
        scanUrl={null}
        category={null}
      />,
    );
    expect(screen.getAllByText(/Alex's Playbook/i).length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText("Type a message...").length).toBeGreaterThan(0);
  });

  it("shows readiness indicator", () => {
    renderWithProviders(
      <TrainingShell
        playbook={createEmptyPlaybook()}
        onUpdatePlaybook={vi.fn()}
        onAdvance={vi.fn()}
        scanUrl={null}
        category={null}
      />,
    );
    expect(screen.getAllByText(/0 of 5 required sections ready/).length).toBeGreaterThan(0);
  });

  it("shows retry copy when the initial website scan fails", () => {
    mockWebsiteScan.isError = true;

    renderWithProviders(
      <TrainingShell
        playbook={createEmptyPlaybook()}
        onUpdatePlaybook={vi.fn()}
        onAdvance={vi.fn()}
        scanUrl="https://example.com"
        category={null}
      />,
    );

    expect(
      screen.getByText(/we couldn't scan that page\. you can retry or keep building manually/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry scan/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue manually/i })).toBeInTheDocument();
  });
});
