import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamBundleCard } from "../team-bundle-card";

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

const mockAgents = [
  {
    name: "Speed-to-Lead Rep",
    slug: "speed-to-lead",
    roleFocus: "leads" as const,
    roleLabel: "qualifies",
  },
  { name: "Sales Closer", slug: "sales-closer", roleFocus: "growth" as const, roleLabel: "closes" },
  {
    name: "Nurture Specialist",
    slug: "nurture-specialist",
    roleFocus: "care" as const,
    roleLabel: "re-engages",
  },
];

describe("TeamBundleCard", () => {
  it("renders bundle title", () => {
    render(<TeamBundleCard agents={mockAgents} stats={{ leads: 12, callsBooked: 3, errors: 0 }} />);
    expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
  });

  it("renders all agent names", () => {
    render(<TeamBundleCard agents={mockAgents} stats={{ leads: 12, callsBooked: 3, errors: 0 }} />);
    expect(screen.getByText("Speed-to-Lead Rep")).toBeInTheDocument();
    expect(screen.getByText("Sales Closer")).toBeInTheDocument();
    expect(screen.getByText("Nurture Specialist")).toBeInTheDocument();
  });

  it("renders deploy CTA", () => {
    render(<TeamBundleCard agents={mockAgents} stats={{ leads: 12, callsBooked: 3, errors: 0 }} />);
    expect(screen.getByText("Deploy this team")).toBeInTheDocument();
  });
});
