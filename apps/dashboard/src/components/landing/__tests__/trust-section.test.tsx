import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrustSection } from "../trust-section";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
  );
});

describe("TrustSection", () => {
  it("renders section header", () => {
    render(<TrustSection />);
    expect(screen.getByText(/you're the boss/i)).toBeInTheDocument();
  });

  it("renders all three trust cards", () => {
    render(<TrustSection />);
    expect(screen.getByText(/starts at zero/i)).toBeInTheDocument();
    expect(screen.getByText(/your ok/i)).toBeInTheDocument();
    expect(screen.getByText(/never claim to be human/i)).toBeInTheDocument();
  });
});
