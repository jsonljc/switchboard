import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditorialShellBoundary } from "../editorial-shell-boundary";

function Boom(): never {
  throw new Error("shell-error");
}

describe("EditorialShellBoundary", () => {
  it("falls back to a minimal banner on error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <EditorialShellBoundary>
        <Boom />
      </EditorialShellBoundary>,
    );
    expect(screen.getByText(/Switchboard — temporarily unavailable/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders children when no error", () => {
    render(
      <EditorialShellBoundary>
        <p>ok</p>
      </EditorialShellBoundary>,
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
