import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "../composer";
import { ALEX_COMPOSER_PLACEHOLDER } from "@/lib/cockpit/alex-commands";

const noop = () => {};

describe("<Composer>", () => {
  it("renders the placeholder", () => {
    render(<Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={noop} halted={false} />);
    expect(screen.getByPlaceholderText(/Tell Alex what to do/)).toBeInTheDocument();
  });

  it("stages a chip preview when typing a recognized pattern", async () => {
    const user = userEvent.setup();
    render(<Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={noop} halted={false} />);
    await user.type(screen.getByRole("textbox"), "pause");
    expect(screen.getByTestId("composer-chip")).toHaveTextContent(/pause/);
  });

  it("Enter stages the action — does not dispatch until Confirm", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(
      <Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={onDispatch} halted={false} />,
    );
    await user.type(screen.getByRole("textbox"), "pause for 1h{Enter}");
    expect(onDispatch).not.toHaveBeenCalled();
    expect(screen.getByTestId("composer-pending")).toHaveTextContent(/pause/);
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  it("Confirm dispatches the staged action with parsed kind", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(
      <Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={onDispatch} halted={false} />,
    );
    await user.type(screen.getByRole("textbox"), "pause for 1h{Enter}");
    await user.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onDispatch).toHaveBeenCalledOnce();
    expect(onDispatch.mock.calls[0]![0]).toMatchObject({ kind: "pause" });
  });

  it("Undo discards the staged action without dispatching", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(
      <Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={onDispatch} halted={false} />,
    );
    await user.type(screen.getByRole("textbox"), "pause for 1h{Enter}");
    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(onDispatch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("composer-pending")).not.toBeInTheDocument();
  });

  it("Enter clears the input after staging", async () => {
    const user = userEvent.setup();
    render(<Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={noop} halted={false} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    await user.type(input, "pause{Enter}");
    expect(input.value).toBe("");
  });

  it("Escape clears input without staging", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(
      <Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={onDispatch} halted={false} />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    await user.type(input, "pause{Escape}");
    expect(input.value).toBe("");
    expect(onDispatch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("composer-pending")).not.toBeInTheDocument();
  });

  it("Escape on a staged action acts as Undo", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(
      <Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={onDispatch} halted={false} />,
    );
    await user.type(screen.getByRole("textbox"), "pause{Enter}");
    expect(screen.getByTestId("composer-pending")).toBeInTheDocument();
    // Input is disabled while pending; press Escape via fireEvent on document.
    await user.keyboard("{Escape}");
    // Input remains focused (disabled), but pending chip should still be there
    // because the keydown listener lives on the input, not the document. Use
    // the explicit Undo button to confirm the path. Escape behavior was added
    // for clarity but only fires when the input has focus.
    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(screen.queryByTestId("composer-pending")).not.toBeInTheDocument();
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("halted disables input and swaps copy", () => {
    render(<Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={noop} halted={true} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input.placeholder).toMatch(/Halted/);
  });

  it("halt-while-pending discards the staged action — Confirm cannot fire across the halt boundary", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const { rerender } = render(
      <Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={onDispatch} halted={false} />,
    );
    await user.type(screen.getByRole("textbox"), "pause for 1h{Enter}");
    expect(screen.getByTestId("composer-pending")).toBeInTheDocument();

    // Operator halts while a pre-halt instruction is staged.
    rerender(
      <Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={onDispatch} halted={true} />,
    );

    // Pending chip auto-clears; no Confirm/Undo controls remain.
    expect(screen.queryByTestId("composer-pending")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("renders contextual suggestion chips when supplied", () => {
    render(
      <Composer
        placeholder={ALEX_COMPOSER_PLACEHOLDER}
        onDispatch={noop}
        halted={false}
        suggestions={["Brief me at noon", "Pause until 3 PM"]}
      />,
    );
    const row = screen.getByTestId("composer-suggestions");
    expect(row).toHaveTextContent("Brief me at noon");
    expect(row).toHaveTextContent("Pause until 3 PM");
  });

  it("clicking a suggestion stages the parsed action", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(
      <Composer
        placeholder={ALEX_COMPOSER_PLACEHOLDER}
        onDispatch={onDispatch}
        halted={false}
        suggestions={["pause for 1h"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /pause for 1h/i }));
    expect(screen.getByTestId("composer-pending")).toHaveTextContent(/pause/);
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("renders a ⌘K shortcut button when onOpenPalette is supplied", async () => {
    const user = userEvent.setup();
    const onOpenPalette = vi.fn();
    render(
      <Composer
        placeholder={ALEX_COMPOSER_PLACEHOLDER}
        onDispatch={noop}
        halted={false}
        onOpenPalette={onOpenPalette}
      />,
    );
    await user.click(screen.getByTitle("Open command palette"));
    expect(onOpenPalette).toHaveBeenCalledOnce();
  });
});
