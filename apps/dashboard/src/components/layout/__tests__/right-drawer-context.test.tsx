/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { RightDrawerProvider, useRightDrawer } from "../right-drawer-context";

function Harness() {
  const drawer = useRightDrawer();
  return (
    <div>
      <span data-testid="kind">{drawer.kind ?? "none"}</span>
      <button onClick={() => drawer.open("inbox")}>open-inbox</button>
      <button onClick={() => drawer.open("opportunity")}>open-opp</button>
      <button onClick={drawer.close}>close</button>
    </div>
  );
}

describe("RightDrawerProvider + useRightDrawer", () => {
  it("starts with kind=null", () => {
    render(
      <RightDrawerProvider>
        <Harness />
      </RightDrawerProvider>,
    );
    expect(screen.getByTestId("kind").textContent).toBe("none");
  });

  it("opens to the requested kind", () => {
    render(
      <RightDrawerProvider>
        <Harness />
      </RightDrawerProvider>,
    );
    act(() => screen.getByText("open-inbox").click());
    expect(screen.getByTestId("kind").textContent).toBe("inbox");
  });

  it("replaces the kind when a different drawer opens (mutual exclusion)", () => {
    render(
      <RightDrawerProvider>
        <Harness />
      </RightDrawerProvider>,
    );
    act(() => screen.getByText("open-inbox").click());
    act(() => screen.getByText("open-opp").click());
    expect(screen.getByTestId("kind").textContent).toBe("opportunity");
  });

  it("replaces the kind in the reverse direction (opportunity → inbox)", () => {
    render(
      <RightDrawerProvider>
        <Harness />
      </RightDrawerProvider>,
    );
    act(() => screen.getByText("open-opp").click());
    act(() => screen.getByText("open-inbox").click());
    expect(screen.getByTestId("kind").textContent).toBe("inbox");
  });

  it("closes when close() is called", () => {
    render(
      <RightDrawerProvider>
        <Harness />
      </RightDrawerProvider>,
    );
    act(() => screen.getByText("open-inbox").click());
    act(() => screen.getByText("close").click());
    expect(screen.getByTestId("kind").textContent).toBe("none");
  });

  it("throws when useRightDrawer is called outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Harness />)).toThrow(/RightDrawerProvider/);
    spy.mockRestore();
  });
});
