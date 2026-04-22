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

vi.mock("@/components/character/agent-mark", () => ({
  AgentMark: () => <div data-testid="agent-mark" />,
  SLUG_TO_AGENT: {} as Record<string, string>,
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

  it("renders Learn more link to profile", () => {
    render(<AgentMarketplaceCard {...mockAgent} />);
    const link = screen.getByText(/learn more/i);
    expect(link.closest("a")).toHaveAttribute("href", "/agents/speed-to-lead");
  });
});
