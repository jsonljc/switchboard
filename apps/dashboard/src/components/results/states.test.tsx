import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetaConnectBanner, ErrorBanner, FirstRunNote, ResultsSkeleton } from "./states";

describe("Results states", () => {
  it("MetaConnectBanner is calm and notes Alex revenue still shows", () => {
    const { container } = render(<MetaConnectBanner />);
    expect(screen.getByText(/No Meta Ads connection/i)).toBeInTheDocument();
    expect(container.textContent?.toLowerCase()).toContain("alex");
  });
  it("ErrorBanner uses the real cache-age (NOT a hardcoded 47)", () => {
    const { container } = render(<ErrorBanner cacheAgeMinutes={12} onRetry={() => {}} />);
    expect(container.textContent).toMatch(/12/);
    expect(container.textContent).not.toMatch(/47/);
  });
  it("FirstRunNote is warm, not failure-framed", () => {
    render(<FirstRunNote />);
    expect(screen.getByText(/first results land here/i)).toBeInTheDocument();
  });
  it("ResultsSkeleton renders status blocks, not a spinner", () => {
    const { container } = render(<ResultsSkeleton />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });
});
