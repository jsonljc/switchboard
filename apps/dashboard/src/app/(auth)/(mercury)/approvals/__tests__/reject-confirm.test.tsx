import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RejectConfirm } from "../components/detail/reject-confirm";

describe("RejectConfirm", () => {
  it("renders the initial Reject button", () => {
    render(<RejectConfirm onConfirm={() => {}} />);
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });

  it("does not show a reason textarea (v1 has no reason field)", () => {
    render(<RejectConfirm onConfirm={() => {}} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("requires a second click to confirm", () => {
    const onConfirm = vi.fn();
    render(<RejectConfirm onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm reject/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("provides a cancel button after first click", () => {
    render(<RejectConfirm onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });
});
