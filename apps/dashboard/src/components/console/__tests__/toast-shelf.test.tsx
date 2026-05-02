import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ToastProvider, useToast } from "../use-toast";
import { ToastShelf } from "../toast-shelf";

function Harness() {
  const { showToast } = useToast();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          showToast({
            title: "Halted",
            detail: "all agents halted — actions queued",
            undoable: true,
            onUndo: () => undoSpy(),
          })
        }
      >
        fire
      </button>
      <button
        type="button"
        onClick={() => showToast({ title: "Saved", detail: "draft", undoable: false })}
      >
        fire-no-undo
      </button>
      <ToastShelf />
    </>
  );
}

const undoSpy = vi.fn();

describe("ToastShelf", () => {
  beforeEach(() => {
    undoSpy.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("renders nothing when no toast is active", () => {
    render(
      <ToastProvider>
        <ToastShelf />
      </ToastProvider>,
    );
    expect(screen.queryByText(/halted/i)).not.toBeInTheDocument();
  });

  it("renders title and detail when a toast is fired", () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("fire").click();
    });
    expect(screen.getByText("Halted")).toBeInTheDocument();
    expect(screen.getByText(/all agents halted — actions queued/i)).toBeInTheDocument();
  });

  it("renders Undo button only when undoable=true", () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("fire").click();
    });
    const undoButton = document.querySelector(".toast-shelf button.undo");
    expect(undoButton).toBeInTheDocument();

    act(() => screen.getByText("fire-no-undo").click());
    const noUndoButton = document.querySelector(".toast-shelf button.undo");
    expect(noUndoButton).not.toBeInTheDocument();
  });

  it("clicking Undo calls onUndo and dismisses the toast", () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("fire").click();
    });
    const undoButton = document.querySelector(".toast-shelf button.undo") as HTMLButtonElement;
    act(() => {
      undoButton.click();
    });
    expect(undoSpy).toHaveBeenCalledOnce();
    expect(screen.queryByText("Halted")).not.toBeInTheDocument();
  });
});
