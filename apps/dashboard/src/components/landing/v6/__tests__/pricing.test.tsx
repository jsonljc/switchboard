import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../glyphs", () => ({ ArrowSig: () => null }));
vi.mock("../reveal", () => ({
  Reveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { V6Pricing } from "../pricing";

describe("V6Pricing card CTAs", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes every card CTA to /register when signup is open", () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "public");

    render(<V6Pricing />);

    const ctas = screen.getAllByRole("link", { name: /start with/i });
    expect(ctas).toHaveLength(3);
    for (const cta of ctas) expect(cta).toHaveAttribute("href", "/register");
  });

  it("routes every card CTA to the waitlist when signup is closed", () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");

    render(<V6Pricing />);

    const ctas = screen.getAllByRole("link", { name: /join the waitlist/i });
    expect(ctas).toHaveLength(3);
    for (const cta of ctas) expect(cta).toHaveAttribute("href", "#waitlist");
    // No mailto concierge links remain.
    expect(screen.queryByRole("link", { name: /start with/i })).not.toBeInTheDocument();
  });
});
