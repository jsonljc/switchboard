import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrgConfig } from "@/hooks/use-org-config";

// Fixture mode so the report body renders (colophon included). The colophon's
// `org · <name>` line must reflect the signed-in org, NOT a hardcoded
// placeholder.
vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: () => false,
  isAgentHomeLinkLive: () => false,
}));
vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => null,
}));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({ data: undefined, isLoading: false }),
}));

const mockUseOrgConfig = vi.fn();
vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: () => mockUseOrgConfig(),
}));

import { ReportsPage } from "../reports-page";

function makeConfig(name: string): { config: OrgConfig } {
  return {
    config: {
      id: "org_test",
      name,
      runtimeType: "managed",
      runtimeConfig: {},
      governanceProfile: "balanced",
      onboardingComplete: true,
      managedChannels: [],
      provisioningStatus: "provisioned",
    },
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReportsPage />
    </QueryClientProvider>,
  );
}

describe("ReportsPage colophon org name", () => {
  it("renders the signed-in org name (not the Aurora Aesthetics placeholder)", () => {
    mockUseOrgConfig.mockReturnValue({ data: makeConfig("Lumen Skin Studio") });
    renderPage();
    // The colophon prints `org · <name>` split across nodes; assert the name.
    expect(screen.getByText("Lumen Skin Studio")).toBeInTheDocument();
    expect(screen.queryByText("Aurora Aesthetics")).toBeNull();
  });

  it("falls back to a graceful label while the org config is still loading", () => {
    mockUseOrgConfig.mockReturnValue({ data: undefined });
    renderPage();
    expect(screen.queryByText("Aurora Aesthetics")).toBeNull();
    // A graceful loading fallback stands in until the name resolves.
    expect(screen.getByText("Your clinic")).toBeInTheDocument();
  });
});
