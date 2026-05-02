import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OpStrip } from "../op-strip";

vi.mock("@/hooks/use-org-config");

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("OpStrip", () => {
  it("renders skeleton while loading", async () => {
    const mod = await import("@/hooks/use-org-config");
    vi.mocked(mod.useOrgConfig).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(<OpStrip />, { wrapper });
    expect(screen.getByLabelText(/loading op strip/i)).toBeInTheDocument();
  });

  it("renders error state with retry on hook error", async () => {
    const refetch = vi.fn();
    const mod = await import("@/hooks/use-org-config");
    vi.mocked(mod.useOrgConfig).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
      refetch,
    } as never);
    render(<OpStrip />, { wrapper });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders org name, Live status, and no Halt button when data is present", async () => {
    const mod = await import("@/hooks/use-org-config");
    vi.mocked(mod.useOrgConfig).mockReturnValue({
      data: {
        config: {
          id: "org-1",
          name: "Aurora Dental",
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
    render(<OpStrip />, { wrapper });
    expect(screen.getByText("Aurora Dental")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /halt/i })).not.toBeInTheDocument();
  });
});
