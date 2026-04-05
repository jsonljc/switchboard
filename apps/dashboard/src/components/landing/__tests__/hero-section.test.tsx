import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroSection } from "../hero-section";

describe("HeroSection", () => {
  it("renders headline and subheadline", () => {
    render(<HeroSection />);
    expect(screen.getByText(/hire ai agents that run your business/i)).toBeInTheDocument();
    expect(screen.getByText(/they start supervised/i)).toBeInTheDocument();
  });

  it("renders all four agent family characters", () => {
    render(<HeroSection />);
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Creative")).toBeInTheDocument();
    expect(screen.getByText("Trading")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });

  it("renders CTA buttons", () => {
    render(<HeroSection />);
    expect(screen.getByRole("link", { name: /get started/i })).toHaveAttribute("href", "/login");
  });

  it("marks Sales as live and others as coming", () => {
    render(<HeroSection />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getAllByText("Coming")).toHaveLength(3);
  });
});
