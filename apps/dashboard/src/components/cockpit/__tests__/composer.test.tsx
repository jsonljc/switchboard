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

  it("Enter calls onDispatch with the parsed action", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(
      <Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={onDispatch} halted={false} />,
    );
    await user.type(screen.getByRole("textbox"), "pause for 1h{Enter}");
    expect(onDispatch).toHaveBeenCalledOnce();
    expect(onDispatch.mock.calls[0]![0]).toMatchObject({ kind: "pause" });
  });

  it("Enter clears the input after dispatch", async () => {
    const user = userEvent.setup();
    render(<Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={noop} halted={false} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    await user.type(input, "pause{Enter}");
    expect(input.value).toBe("");
  });

  it("Escape clears input without dispatching", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(
      <Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={onDispatch} halted={false} />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    await user.type(input, "pause{Escape}");
    expect(input.value).toBe("");
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("halted disables input and swaps copy", () => {
    render(<Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={noop} halted={true} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input.placeholder).toMatch(/Halted/);
  });
});
