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
vi.mock("@/components/settings/operational-state/operational-state-section", () => ({
  OperationalStateSection: ({ timezone }: { timezone: string }) => (
    <div data-testid="operational-state-section" data-timezone={timezone} />
  ),
}));

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

  it("populates the form with saved facts when status is present", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: "dep_1", isLoading: false, isError: false });
    useBusinessFacts.mockReturnValue({
      data: {
        status: "present",
        facts: {
          businessName: "Saved Clinic",
          timezone: "Asia/Singapore",
          locations: [{ name: "Main Branch", address: "1 Orchard Rd" }],
          openingHours: {
            monday: { open: "10:00", close: "20:00", closed: false },
            tuesday: { open: "10:00", close: "20:00", closed: false },
            wednesday: { open: "10:00", close: "20:00", closed: false },
            thursday: { open: "10:00", close: "20:00", closed: false },
            friday: { open: "10:00", close: "20:00", closed: false },
            saturday: { open: "10:00", close: "18:00", closed: false },
            sunday: { open: "10:00", close: "18:00", closed: true },
          },
          services: [{ name: "Botox", description: "Anti-wrinkle treatment" }],
          escalationContact: { name: "Front desk", channel: "whatsapp", address: "+6560000000" },
          additionalFaqs: [],
        },
      },
      error: null,
    });
    render(<BusinessFactsPage />);
    expect(screen.getByDisplayValue("Saved Clinic")).toBeInTheDocument();
  });

  it("renders the operational-state sibling section when a deployment exists", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: "dep_1", isLoading: false, isError: false });
    useBusinessFacts.mockReturnValue({ data: { facts: null, status: "missing" }, error: null });
    render(<BusinessFactsPage />);
    expect(screen.getByTestId("operational-state-section")).toBeInTheDocument();
    expect(screen.getByTestId("operational-state-section").dataset.timezone).toBe("Asia/Singapore");
  });

  it("renders a StatePanel error state when business facts query fails", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: "dep_1", isLoading: false, isError: false });
    useBusinessFacts.mockReturnValue({ data: undefined, error: new Error("Network error") });
    render(<BusinessFactsPage />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    // eyebrow "Couldn't load" and title both contain "couldn't load" — use getAllByText
    expect(screen.getAllByText(/couldn't load/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/we couldn't load your business facts/i)).toBeInTheDocument();
    // Old raw error text must NOT appear
    expect(screen.queryByText(/failed to load business facts/i)).not.toBeInTheDocument();
  });

  it("passes the saved org timezone to the operational-state section", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: "dep_1", isLoading: false, isError: false });
    useBusinessFacts.mockReturnValue({
      data: {
        status: "present",
        facts: { businessName: "Saved Clinic", timezone: "America/New_York" },
      },
      error: null,
    });
    render(<BusinessFactsPage />);
    expect(screen.getByTestId("operational-state-section").dataset.timezone).toBe(
      "America/New_York",
    );
  });
});
