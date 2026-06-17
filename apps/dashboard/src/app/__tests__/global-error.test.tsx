import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import GlobalError from "../global-error";

// global-error.tsx is the LAST-resort fallback Next renders when the root layout
// itself throws. It must show a branded, recoverable surface (not Next's default
// white screen) and let the user retry via `reset`. It renders its own <html>/
// <body>; jsdom warns on that nesting but the content is still queryable, which
// is all this asserts.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderGlobalError(reset = vi.fn(), digest?: string) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const error = Object.assign(new Error("root layout exploded"), digest ? { digest } : {});
  render(<GlobalError error={error} reset={reset} />);
  return { reset };
}

describe("GlobalError (root layout fallback)", () => {
  it("renders a branded, alert-role fallback heading", () => {
    renderGlobalError();
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /something went wrong/i })).toBeInTheDocument();
  });

  it("calls reset() when the user clicks Try again", () => {
    const { reset } = renderGlobalError();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows the error digest reference when present", () => {
    renderGlobalError(vi.fn(), "abc123digest");
    expect(screen.getByText(/abc123digest/)).toBeInTheDocument();
  });

  it("omits the digest line when there is no digest", () => {
    renderGlobalError();
    expect(screen.queryByText(/^Ref:/)).toBeNull();
  });
});
