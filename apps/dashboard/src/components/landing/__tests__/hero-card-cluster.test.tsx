import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroCardCluster } from "../hero-card-cluster";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/character/agent-mark", () => ({
  AgentMark: ({ agent }: { agent: string }) => <div data-testid={`mark-${agent}`} />,
  SLUG_TO_AGENT: {
    "speed-to-lead": "alex",
    "sales-closer": "morgan",
    "nurture-specialist": "jordan",
  },
}));

const agents = [
  {
    name: "Speed-to-Lead",
    slug: "speed-to-lead",
    description: "Qualifies leads fast.",
    trustScore: 84,
  },
  { name: "Sales Closer", slug: "sales-closer", description: "Books and closes.", trustScore: 76 },
  {
    name: "Nurture Specialist",
    slug: "nurture-specialist",
    description: "Keeps contacts warm.",
    trustScore: 62,
  },
];

describe("HeroCardCluster", () => {
  it("renders primary agent name", () => {
    render(<HeroCardCluster agents={agents} />);
    expect(screen.getByText("Speed-to-Lead")).toBeInTheDocument();
  });

  it("renders primary trust score", () => {
    render(<HeroCardCluster agents={agents} />);
    expect(screen.getByText("84")).toBeInTheDocument();
  });

  it("renders Learn more link for primary agent", () => {
    render(<HeroCardCluster agents={agents} />);
    const link = screen.getByRole("link", { name: /learn more/i });
    expect(link).toHaveAttribute("href", "/agents/speed-to-lead");
  });

  it("renders without crashing when fewer than 3 agents provided", () => {
    render(<HeroCardCluster agents={agents.slice(0, 1)} />);
    expect(screen.getByText("Speed-to-Lead")).toBeInTheDocument();
  });
});
