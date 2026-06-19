import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatePanel } from "./state-panel";

describe("StatePanel", () => {
  it("renders title + body and defaults to a calm status role", () => {
    render(<StatePanel title="All caught up." body="Nothing waiting." />);
    expect(screen.getByText("All caught up.")).toBeInTheDocument();
    expect(screen.getByText("Nothing waiting.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the title as a heading (consumers disambiguate by role)", () => {
    render(<StatePanel title="That's everything." />);
    expect(screen.getByRole("heading", { name: /that's everything/i })).toBeInTheDocument();
  });

  it("renders an alert role with a mono eyebrow for genuine failures", () => {
    render(<StatePanel role="alert" eyebrow="Couldn't load" title="We hit a snag." />);
    expect(screen.getByText("Couldn't load")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders an amber retry button wired to onRetry (default label 'Try again')", () => {
    const onRetry = vi.fn();
    render(<StatePanel role="alert" title="x" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("supports a custom retry label and a footer slot", () => {
    render(
      <StatePanel title="x" onRetry={() => {}} retryLabel="Reload">
        meta-line
      </StatePanel>,
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByText("meta-line")).toBeInTheDocument();
  });

  it("never renders a button when onRetry is absent (calm empty has no action)", () => {
    render(<StatePanel title="x" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("never renders the body element when body is omitted", () => {
    const { container } = render(<StatePanel title="only-title" />);
    expect(container.querySelectorAll("p").length).toBe(0);
  });
});
