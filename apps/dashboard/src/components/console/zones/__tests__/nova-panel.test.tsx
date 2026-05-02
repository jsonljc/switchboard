import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NovaPanel } from "../nova-panel";

vi.mock("@/hooks/use-module-status");

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("NovaPanel", () => {
  it("renders empty state when ad-optimizer is not live", async () => {
    const mod = await import("@/hooks/use-module-status");
    vi.mocked(mod.useModuleStatus).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(<NovaPanel />, { wrapper });
    expect(screen.getByText(/no ad-optimizer deployed/i)).toBeInTheDocument();
  });

  it("renders empty state when ad-optimizer module is present but not live", async () => {
    const mod = await import("@/hooks/use-module-status");
    vi.mocked(mod.useModuleStatus).mockReturnValue({
      data: [{ id: "ad-optimizer", state: "draft" }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(<NovaPanel />, { wrapper });
    expect(screen.getByText(/no ad-optimizer deployed/i)).toBeInTheDocument();
  });

  it("renders panel when ad-optimizer is live", async () => {
    const mod = await import("@/hooks/use-module-status");
    vi.mocked(mod.useModuleStatus).mockReturnValue({
      data: [{ id: "ad-optimizer", state: "live" }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(<NovaPanel />, { wrapper });
    expect(screen.queryByText(/no ad-optimizer deployed/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Ad actions/i)).toBeInTheDocument();
  });
});
