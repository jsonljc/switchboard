import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../glyphs", () => ({ ArrowSig: () => null }));

import { V6Topbar } from "../topbar";

describe("V6Topbar primary CTA", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("links Get started to /register when signup is open", () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "public");

    render(<V6Topbar />);

    expect(screen.getByRole("link", { name: /get started/i })).toHaveAttribute("href", "/register");
  });

  it("links to the on-page waitlist when signup is closed", () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");

    render(<V6Topbar />);

    expect(screen.getByRole("link", { name: /join the waitlist/i })).toHaveAttribute(
      "href",
      "#waitlist",
    );
    expect(screen.queryByRole("link", { name: /get started/i })).not.toBeInTheDocument();
  });
});
