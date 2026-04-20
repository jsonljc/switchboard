import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BeforeAfterStrip } from "../before-after-strip";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn().mockImplementation((callback) => ({
      observe: vi.fn((el) => {
        callback([{ isIntersecting: true, target: el }]);
      }),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );
});

describe("BeforeAfterStrip", () => {
  const props = {
    title: "The lead you lost",
    before: {
      visual: <div data-testid="before-visual">11:47 PM</div>,
      copy: "You replied the next morning. She'd already booked elsewhere.",
    },
    after: {
      visual: <div data-testid="after-visual">Booked</div>,
      copy: "Alex responded at 11:47 PM, qualified, and booked Tuesday 10am.",
      microDetail: "Responded in 12 sec",
      outcomeTag: "Booked in 90 seconds.",
    },
  };

  it("renders the scenario title", () => {
    render(<BeforeAfterStrip {...props} />);
    expect(screen.getByText("The lead you lost")).toBeInTheDocument();
  });

  it("renders before copy", () => {
    render(<BeforeAfterStrip {...props} />);
    expect(screen.getByText(/You replied the next morning/i)).toBeInTheDocument();
  });

  it("renders after copy and outcome tag", () => {
    render(<BeforeAfterStrip {...props} />);
    expect(screen.getByText(/Alex responded at 11:47 PM/i)).toBeInTheDocument();
    expect(screen.getByText("Booked in 90 seconds.")).toBeInTheDocument();
  });

  it("renders micro detail", () => {
    render(<BeforeAfterStrip {...props} />);
    expect(screen.getByText("Responded in 12 sec")).toBeInTheDocument();
  });
});
