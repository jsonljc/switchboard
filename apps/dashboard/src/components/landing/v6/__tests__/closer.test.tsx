import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../glyphs", () => ({ ArrowSig: () => null }));
vi.mock("../agent-toggle", () => ({ AgentToggle: () => null }));

import { AgentProvider } from "../agent-context";
import { V6Closer } from "../closer";

describe("V6Closer primary CTA", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const renderCloser = () =>
    render(
      <AgentProvider>
        <V6Closer />
      </AgentProvider>,
    );

  it("sends the primary CTA to /register when signup is open", () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "public");

    renderCloser();

    expect(screen.getByRole("link", { name: /start with/i })).toHaveAttribute("href", "/register");
  });

  it("sends the primary CTA to the on-page waitlist when signup is closed", () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");

    renderCloser();

    expect(screen.getByRole("link", { name: /join the waitlist/i })).toHaveAttribute(
      "href",
      "#waitlist",
    );
  });
});
