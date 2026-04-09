import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentMarketplaceCard } from "../agent-marketplace-card";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );
});

const mockAgent = {
  name: "Speed-to-Lead Rep",
  slug: "speed-to-lead",
  description: "Responds to inbound leads within 60 seconds.",
  trustScore: 47,
  autonomyLevel: "supervised",
  roleFocus: "leads" as const,
  bundleSlug: "sales-pipeline-bundle",
  stats: { totalTasks: 12, approvalRate: 98, lastActiveAt: new Date().toISOString() },
};

describe("AgentMarketplaceCard", () => {
  it("renders agent name", () => {
    render(<AgentMarketplaceCard {...mockAgent} />);
    expect(screen.getByText("Speed-to-Lead Rep")).toBeInTheDocument();
  });

  it("renders trust score", () => {
    render(<AgentMarketplaceCard {...mockAgent} />);
    expect(screen.getByText("47")).toBeInTheDocument();
  });

  it("renders autonomy badge", () => {
    render(<AgentMarketplaceCard {...mockAgent} />);
    expect(screen.getByText(/supervised/i)).toBeInTheDocument();
  });

  it("renders Hire link to bundle", () => {
    render(<AgentMarketplaceCard {...mockAgent} />);
    const hireLink = screen.getByText("Hire");
    expect(hireLink.closest("a")).toHaveAttribute("href", "/deploy/sales-pipeline-bundle");
  });

  it("renders See work link to profile", () => {
    render(<AgentMarketplaceCard {...mockAgent} />);
    const workLink = screen.getByText(/see work/i);
    expect(workLink.closest("a")).toHaveAttribute("href", "/agents/speed-to-lead");
  });
});
