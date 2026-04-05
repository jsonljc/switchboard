import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CategoryTabs } from "../category-tabs";
import type { MarketplaceListing } from "@/lib/demo-data";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("CategoryTabs", () => {
  const mockFamilies: MarketplaceListing[] = [
    {
      id: "sales-family",
      name: "Sales Pipeline Family",
      slug: "sales-pipeline-family",
      description: "Lead generation and nurturing agents",
      type: "bundle",
      status: "listed",
      taskCategories: [],
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      metadata: { family: "sales", isBundle: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "creative-family",
      name: "Creative Family",
      slug: "creative-family",
      description: "Content creation agents",
      type: "bundle",
      status: "pending_review",
      taskCategories: [],
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      metadata: { family: "creative", isBundle: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "trading-family",
      name: "Trading Family",
      slug: "trading-family",
      description: "Financial trading agents",
      type: "bundle",
      status: "pending_review",
      taskCategories: [],
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      metadata: { family: "trading", isBundle: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  it("renders all family tab names", () => {
    render(
      <CategoryTabs families={mockFamilies} activeFamily="sales">
        <div>Test content</div>
      </CategoryTabs>,
    );

    expect(screen.getByText("Sales Pipeline Family")).toBeInTheDocument();
    expect(screen.getByText("Creative Family")).toBeInTheDocument();
    expect(screen.getByText("Trading Family")).toBeInTheDocument();
  });

  it("shows live indicator on sales tab", () => {
    render(
      <CategoryTabs families={mockFamilies} activeFamily="sales">
        <div>Test content</div>
      </CategoryTabs>,
    );

    const liveIndicators = screen.getAllByTestId("live-indicator");
    expect(liveIndicators).toHaveLength(1);
  });

  it("shows children content when sales tab active", () => {
    render(
      <CategoryTabs families={mockFamilies} activeFamily="sales">
        <div>Test content</div>
      </CategoryTabs>,
    );

    expect(screen.getByText("Test content")).toBeInTheDocument();
  });
});
