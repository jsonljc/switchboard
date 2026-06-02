import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useOrgDeploymentId = vi.fn();
const useBusinessFacts = vi.fn();
const useUpsertBusinessFacts = vi.fn();
vi.mock("@/hooks/use-deployments", () => ({ useOrgDeploymentId: () => useOrgDeploymentId() }));
vi.mock("@/hooks/use-business-facts", () => ({
  useBusinessFacts: () => useBusinessFacts(),
  useUpsertBusinessFacts: () => useUpsertBusinessFacts(),
  BusinessFactsValidationError: class extends Error {},
}));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import BusinessFactsPage from "@/app/(auth)/settings/business-facts/page";

describe("BusinessFactsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUpsertBusinessFacts.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("shows an empty state when the org has no deployment", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: null, isLoading: false, isError: false });
    useBusinessFacts.mockReturnValue({ data: undefined, error: null, isLoading: false });
    render(<BusinessFactsPage />);
    expect(screen.getByText(/deploy an agent first/i)).toBeInTheDocument();
  });

  it("renders the form when facts are missing (scaffold)", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: "dep_1", isLoading: false, isError: false });
    useBusinessFacts.mockReturnValue({ data: { facts: null, status: "missing" }, error: null });
    render(<BusinessFactsPage />);
    expect(screen.getByRole("button", { name: /save business facts/i })).toBeInTheDocument();
  });

  it("shows the malformed banner", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: "dep_1", isLoading: false, isError: false });
    useBusinessFacts.mockReturnValue({ data: { facts: null, status: "malformed" }, error: null });
    render(<BusinessFactsPage />);
    expect(screen.getByText(/weren't loaded|re-enter/i)).toBeInTheDocument();
  });
});
