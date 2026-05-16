// apps/dashboard/src/lib/data-mode/__tests__/client.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { DataModeProvider, useDataMode, useSetDataMode, useDataModeControls } from "../client";
import type { DataMode } from "../shared";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function ModeReader() {
  const mode = useDataMode();
  return <span data-testid="mode">{mode}</span>;
}

function SetterReader({ next }: { next: DataMode }) {
  const setMode = useSetDataMode();
  return (
    <button type="button" data-testid="setter" onClick={() => setMode(next)}>
      set
    </button>
  );
}

function ControlsReader() {
  const { mode, setMode } = useDataModeControls();
  return (
    <>
      <span data-testid="ctrl-mode">{mode}</span>
      <button type="button" data-testid="ctrl-set" onClick={() => setMode("demo")}>
        demo
      </button>
    </>
  );
}

beforeEach(() => {
  refreshMock.mockReset();
  // Restore document.cookie's prototype descriptor in case a prior test
  // installed an instance-level spy (the secure-flag tests do this).
  // Without this restore, the spy bleeds into subsequent tests.
  const cookieProto = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  if (cookieProto) Object.defineProperty(document, "cookie", cookieProto);
  // jsdom's cookie jar persists across tests; clear what we set.
  document.cookie = "sw.data-mode=; path=/; max-age=0";
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { protocol: "http:" },
  });
});

describe("DataModeProvider + useDataMode", () => {
  it("returns the mode passed to the provider", () => {
    render(
      <DataModeProvider mode="demo">
        <ModeReader />
      </DataModeProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("demo");
  });

  it("returns 'live' by default when used outside a provider", () => {
    render(<ModeReader />);
    expect(screen.getByTestId("mode")).toHaveTextContent("live");
  });

  it("seeds value from props on first render (no hydration drift)", () => {
    const { rerender } = render(
      <DataModeProvider mode="demo">
        <ModeReader />
      </DataModeProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("demo");
    rerender(
      <DataModeProvider mode="live">
        <ModeReader />
      </DataModeProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("live");
  });
});

describe("useSetDataMode", () => {
  it("writes a cookie containing sw.data-mode=demo", () => {
    render(
      <DataModeProvider mode="live">
        <SetterReader next="demo" />
      </DataModeProvider>,
    );
    act(() => screen.getByTestId("setter").click());
    expect(document.cookie).toContain("sw.data-mode=demo");
  });

  it("calls router.refresh() exactly once per write", () => {
    render(
      <DataModeProvider mode="live">
        <SetterReader next="demo" />
      </DataModeProvider>,
    );
    act(() => screen.getByTestId("setter").click());
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("includes 'secure' flag when window.location.protocol === 'https:'", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { protocol: "https:" },
    });
    const cookieWrites: string[] = [];
    const proto = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    if (!proto || !proto.set || !proto.get) throw new Error("no cookie descriptor");
    const origSet = proto.set.bind(document);
    const origGet = proto.get.bind(document);
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => origGet(),
      set: (v: string) => {
        cookieWrites.push(v);
        origSet(v);
      },
    });

    render(
      <DataModeProvider mode="live">
        <SetterReader next="demo" />
      </DataModeProvider>,
    );
    act(() => screen.getByTestId("setter").click());

    expect(cookieWrites.some((c) => c.includes("secure"))).toBe(true);
  });

  it("excludes 'secure' flag on http:", () => {
    const cookieWrites: string[] = [];
    const proto = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    if (!proto || !proto.set || !proto.get) throw new Error("no cookie descriptor");
    const origSet = proto.set.bind(document);
    const origGet = proto.get.bind(document);
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => origGet(),
      set: (v: string) => {
        cookieWrites.push(v);
        origSet(v);
      },
    });

    render(
      <DataModeProvider mode="live">
        <SetterReader next="demo" />
      </DataModeProvider>,
    );
    act(() => screen.getByTestId("setter").click());

    expect(cookieWrites.some((c) => c.includes("secure"))).toBe(false);
  });
});

describe("useDataModeControls", () => {
  it("returns { mode, setMode } as one object", () => {
    render(
      <DataModeProvider mode="demo">
        <ControlsReader />
      </DataModeProvider>,
    );
    expect(screen.getByTestId("ctrl-mode")).toHaveTextContent("demo");
    act(() => screen.getByTestId("ctrl-set").click());
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
