import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrainingShell } from "../training-shell";
import { createEmptyPlaybook } from "@switchboard/schemas";

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("TrainingShell", () => {
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
});
