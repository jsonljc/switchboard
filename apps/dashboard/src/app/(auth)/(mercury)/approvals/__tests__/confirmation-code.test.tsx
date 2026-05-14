import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfirmationCode } from "../components/detail/confirmation-code";

const HASH = "0x2f1a08c4e9b1d7a4f0c3b8a5d2e7f1a9";
const ENV = "env_2f1a08c4";

describe("ConfirmationCode", () => {
  afterEach(() => {
    // Reset clipboard between tests so a previously installed mock doesn't
    // leak to a test that doesn't intend to use it.
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  it("renders the full hash visible (not behind a click)", () => {
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    expect(screen.getByText(HASH)).toBeInTheDocument();
  });

  it("renders the operator-language eyebrow", () => {
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    expect(screen.getByText(/confirmation code/i)).toBeInTheDocument();
    expect(screen.getByText(/locks in the details above/i)).toBeInTheDocument();
  });

  it("renders the reference id (operator-language for envelope)", () => {
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    expect(screen.getByText(/Reference:/i)).toBeInTheDocument();
    expect(screen.getByText(ENV)).toBeInTheDocument();
  });

  it("no engineering vocabulary in visible text (excluding the code value)", () => {
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-testid="confirmation-code-value"]').forEach((el) => el.remove());
    const text = clone.textContent ?? "";
    expect(text).not.toMatch(/binding|envelope|sha256|lifecycle|dispatch/i);
  });

  it("calls clipboard.writeText on copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    fireEvent.click(screen.getByRole("button", { name: /copy code/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH));
  });

  it("falls back gracefully when clipboard write fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    fireEvent.click(screen.getByRole("button", { name: /copy code/i }));
    await waitFor(() => expect(screen.getByText(/couldn't copy/i)).toBeInTheDocument());
  });
});
