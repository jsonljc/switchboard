import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelineSection } from "../timeline-section";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
  );
});

describe("TimelineSection", () => {
  it("renders the section header", () => {
    render(<TimelineSection />);
    expect(screen.getByText(/see it in action/i)).toBeInTheDocument();
    expect(screen.getByText(/sales pipeline/i)).toBeInTheDocument();
  });

  it("renders all timeline entries", () => {
    render(<TimelineSection />);
    expect(screen.getByText(/fills out your contact form/i)).toBeInTheDocument();
    expect(screen.getByText(/speed-to-lead/i)).toBeInTheDocument();
    expect(screen.getByText(/handles objections/i)).toBeInTheDocument();
    expect(screen.getByText(/you were asleep/i)).toBeInTheDocument();
  });

  it("has the scroll target id", () => {
    const { container } = render(<TimelineSection />);
    expect(container.querySelector("#see-it-in-action")).not.toBeNull();
  });
});
