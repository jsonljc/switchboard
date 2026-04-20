import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScrollytellingSection } from "../scrollytelling-section";

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

beforeAll(() => {
  // Mock IntersectionObserver
  global.IntersectionObserver = class {
    constructor(private cb: IntersectionObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;

  // Mock window.matchMedia
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

describe("ScrollytellingSection", () => {
  it("renders all three step headings", () => {
    render(<ScrollytellingSection />);
    expect(screen.getByText("Start with the outcome you need.")).toBeInTheDocument();
    expect(
      screen.getByText("Go live on the channels your customers already use."),
    ).toBeInTheDocument();
    expect(screen.getByText("Starts supervised. Earns speed.")).toBeInTheDocument();
  });

  it("renders step labels", () => {
    render(<ScrollytellingSection />);
    expect(screen.getByText("01 — Choose")).toBeInTheDocument();
    expect(screen.getByText("02 — Connect")).toBeInTheDocument();
    expect(screen.getByText("03 — Trust")).toBeInTheDocument();
  });

  it("renders the closing line", () => {
    render(<ScrollytellingSection />);
    expect(screen.getByText(/From setup to first live lead conversation/i)).toBeInTheDocument();
  });
});
