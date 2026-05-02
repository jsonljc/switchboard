import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "../use-keyboard-shortcuts";

function fireKey(key: string, opts: KeyboardEventInit = {}, target?: Element) {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, ...opts });
  if (target) {
    Object.defineProperty(ev, "target", { value: target, writable: false });
  }
  window.dispatchEvent(ev);
}

describe("useKeyboardShortcuts", () => {
  it("calls help handler on '?'", () => {
    const help = vi.fn();
    renderHook(() => useKeyboardShortcuts({ help }));
    fireKey("?");
    expect(help).toHaveBeenCalledOnce();
  });

  it("calls help handler on Shift+/", () => {
    const help = vi.fn();
    renderHook(() => useKeyboardShortcuts({ help }));
    fireKey("/", { shiftKey: true });
    expect(help).toHaveBeenCalledOnce();
  });

  it("calls halt handler on 'h' and 'H'", () => {
    const halt = vi.fn();
    renderHook(() => useKeyboardShortcuts({ halt }));
    fireKey("h");
    fireKey("H");
    expect(halt).toHaveBeenCalledTimes(2);
  });

  it("calls escape handler on 'Escape'", () => {
    const escape = vi.fn();
    renderHook(() => useKeyboardShortcuts({ escape }));
    fireKey("Escape");
    expect(escape).toHaveBeenCalledOnce();
  });

  it("ignores keys when target is INPUT", () => {
    const help = vi.fn();
    renderHook(() => useKeyboardShortcuts({ help }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey("?", {}, input);
    expect(help).not.toHaveBeenCalled();
    input.remove();
  });

  it("ignores keys when target is TEXTAREA", () => {
    const help = vi.fn();
    renderHook(() => useKeyboardShortcuts({ help }));
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    fireKey("?", {}, ta);
    expect(help).not.toHaveBeenCalled();
    ta.remove();
  });

  it("ignores keys when target is contentEditable", () => {
    const help = vi.fn();
    renderHook(() => useKeyboardShortcuts({ help }));
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    fireKey("?", {}, div);
    expect(help).not.toHaveBeenCalled();
    div.remove();
  });

  it("does nothing for unbound keys", () => {
    const help = vi.fn();
    const halt = vi.fn();
    const escape = vi.fn();
    renderHook(() => useKeyboardShortcuts({ help, halt, escape }));
    fireKey("a");
    fireKey("1");
    expect(help).not.toHaveBeenCalled();
    expect(halt).not.toHaveBeenCalled();
    expect(escape).not.toHaveBeenCalled();
  });

  it("removes the listener on unmount", () => {
    const help = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts({ help }));
    unmount();
    fireKey("?");
    expect(help).not.toHaveBeenCalled();
  });
});
