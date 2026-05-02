import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OpStrip } from "../op-strip";
import { ToastProvider } from "../../use-toast";
import { ToastShelf } from "../../toast-shelf";

vi.mock("@/hooks/use-org-config");

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        {ui}
        <ToastShelf />
      </ToastProvider>
    </QueryClientProvider>
  );
}

function mockOrgConfig(name = "Aurora Dental") {
  return import("@/hooks/use-org-config").then((mod) => {
    vi.mocked(mod.useOrgConfig).mockReturnValue({
      data: {
        config: {
          id: "org-1",
          name,
          runtimeType: "default",
          runtimeConfig: {},
          governanceProfile: "default",
          onboardingComplete: true,
          managedChannels: [],
          provisioningStatus: "active",
        },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
  });
}

describe("OpStrip", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("renders skeleton while loading", async () => {
    const mod = await import("@/hooks/use-org-config");
    vi.mocked(mod.useOrgConfig).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(wrap(<OpStrip onHelpOpen={vi.fn()} />));
    expect(screen.getByLabelText(/loading op strip/i)).toBeInTheDocument();
  });

  it("renders error with retry on hook error", async () => {
    const mod = await import("@/hooks/use-org-config");
    vi.mocked(mod.useOrgConfig).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
      refetch: vi.fn(),
    } as never);
    render(wrap(<OpStrip onHelpOpen={vi.fn()} />));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders org name, Live status, Halt button, Help button when loaded", async () => {
    await mockOrgConfig("Aurora Dental");
    render(wrap(<OpStrip onHelpOpen={vi.fn()} />));
    expect(screen.getByText("Aurora Dental")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /halt/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\? help/i })).toBeInTheDocument();
  });

  it("clicking Halt swaps Live → Halted and fires undoable toast", async () => {
    await mockOrgConfig();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<OpStrip onHelpOpen={vi.fn()} />));
    await user.click(screen.getByRole("button", { name: "Halt" }));
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(window.localStorage.getItem("sb_halt_state")).toBe("1");
    expect(screen.getByText(/all agents halted/i)).toBeInTheDocument();
  });

  it("clicking Resume from halted state restores Live", async () => {
    window.localStorage.setItem("sb_halt_state", "1");
    await mockOrgConfig();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<OpStrip onHelpOpen={vi.fn()} />));
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(window.localStorage.getItem("sb_halt_state")).toBe("0");
  });

  it("Undo on the halt toast restores the previous halted state", async () => {
    await mockOrgConfig();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<OpStrip onHelpOpen={vi.fn()} />));
    await user.click(screen.getByRole("button", { name: "Halt" }));
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("clicking Help calls onHelpOpen", async () => {
    await mockOrgConfig();
    const onHelpOpen = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<OpStrip onHelpOpen={onHelpOpen} />));
    await user.click(screen.getByRole("button", { name: /\? help/i }));
    expect(onHelpOpen).toHaveBeenCalledOnce();
  });
});
