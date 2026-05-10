import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "../empty-state";

describe("EmptyState", () => {
  it("renders 8 skeleton rows on the loading variant", () => {
    const { container } = render(<EmptyState variant="loading" />);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(8);
    expect(screen.getByRole("status", { name: "Loading contacts" })).toBeInTheDocument();
  });

  it("renders Mercury voice on the zero variant — no agent prose", () => {
    render(<EmptyState variant="zero" />);
    expect(screen.getByText(/No contacts yet/)).toBeInTheDocument();
    expect(screen.getByText(/conversations come in/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the Clear affordance on the filtered variant", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<EmptyState variant="filtered" onClear={onClear} />);
    expect(screen.getByText(/No matches/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Clear/ }));
    expect(onClear).toHaveBeenCalled();
  });

  it("renders the Try again affordance on the error variant", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<EmptyState variant="error" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn[’']t load contacts/);
    await user.click(screen.getByRole("button", { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalled();
  });
});
