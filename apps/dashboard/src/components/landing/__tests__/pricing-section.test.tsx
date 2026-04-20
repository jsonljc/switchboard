import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PricingSection } from "../pricing-section";

describe("PricingSection", () => {
  it("renders pricing headline", () => {
    render(<PricingSection />);
    expect(screen.getByText("Simple pricing for your first booking agent.")).toBeInTheDocument();
  });

  it("renders Alex card with price", () => {
    render(<PricingSection />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Your first booking agent")).toBeInTheDocument();
    expect(screen.getByText(/\$49/)).toBeInTheDocument();
  });

  it("renders all feature items", () => {
    render(<PricingSection />);
    expect(screen.getByText("Instant lead response")).toBeInTheDocument();
    expect(screen.getByText("Approval-first controls")).toBeInTheDocument();
    expect(screen.getByText("Full audit trail")).toBeInTheDocument();
  });

  it("renders CTA button", () => {
    render(<PricingSection />);
    expect(screen.getByRole("link", { name: /get started/i })).toBeInTheDocument();
  });

  it("renders FAQ questions", () => {
    render(<PricingSection />);
    expect(screen.getByText(/credit card/i)).toBeInTheDocument();
    expect(screen.getByText(/without my approval/i)).toBeInTheDocument();
  });
});
