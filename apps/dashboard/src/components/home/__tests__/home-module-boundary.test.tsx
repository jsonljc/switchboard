import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeModuleBoundary } from "../home-module-boundary";

/** A child component that throws unconditionally on render. */
function ThrowingChild(): React.ReactElement {
  throw new Error("test render throw");
}

/** A sibling component that does not throw. */
function SafeChild(): React.ReactElement {
  return <div data-testid="safe-sibling">Sibling rendered fine</div>;
}

describe("HomeModuleBoundary", () => {
  it("renders children when no error occurs", () => {
    render(
      <HomeModuleBoundary>
        <SafeChild />
      </HomeModuleBoundary>,
    );
    expect(screen.getByTestId("safe-sibling")).toBeInTheDocument();
  });

  it("renders the default fallback when a child throws", () => {
    // Suppress React's console.error for expected boundary catches in this test.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <HomeModuleBoundary>
        <ThrowingChild />
      </HomeModuleBoundary>,
    );
    expect(screen.getByText(/This section is unavailable/i)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("renders a custom fallback prop when a child throws", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <HomeModuleBoundary fallback={<span data-testid="custom-fallback">Custom error</span>}>
        <ThrowingChild />
      </HomeModuleBoundary>,
    );
    expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
    expect(screen.queryByText(/This section is unavailable/i)).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("a throwing module does not prevent sibling boundaries from rendering", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <HomeModuleBoundary>
          <ThrowingChild />
        </HomeModuleBoundary>
        <HomeModuleBoundary>
          <SafeChild />
        </HomeModuleBoundary>
      </div>,
    );
    // Throwing module shows fallback.
    expect(screen.getByText(/This section is unavailable/i)).toBeInTheDocument();
    // Sibling module renders normally.
    expect(screen.getByTestId("safe-sibling")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
