import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import { HaltProvider, useHalt } from "@/components/layout/halt/halt-context";
import { useAlexActionDispatcher } from "../alex-action-dispatcher";

// Tool A: stub use-governance so HaltProvider mounts without QueryClient/SessionProvider.
// data: undefined prevents the server-sync useEffect from overriding optimistic local state.
vi.mock("@/hooks/use-governance", () => ({
  useGovernanceStatus: () => ({ data: undefined, isLoading: false }),
  useEmergencyHalt: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useResume: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
}));

const pushMock = vi.fn();
const toastMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, prefetch: vi.fn() }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <HaltProvider>{children}</HaltProvider>;
}

// CRITICAL: dispatcher + halt must share ONE provider instance, otherwise
// the dispatcher's setHalted call writes to a different provider than the
// halt.halted assertion reads from. Use a single renderHook with a combined
// hook to guarantee one wrapper render = one HaltProvider.
function setup() {
  return renderHook(
    () => ({
      dispatch: useAlexActionDispatcher(),
      halt: useHalt(),
    }),
    { wrapper },
  );
}

beforeEach(() => {
  pushMock.mockReset();
  toastMock.mockReset();
  if (typeof window !== "undefined") window.localStorage.clear();
});

describe("useAlexActionDispatcher", () => {
  it("pause flips halt true and toasts", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "pause",
        icon: "⏸",
        label: "pause",
        detail: "until you resume",
        raw: "pause",
      });
    });
    expect(result.current.halt.halted).toBe(true);
    expect(toastMock).toHaveBeenCalledOnce();
  });

  it("resume flips halt false", () => {
    const { result } = setup();
    act(() => result.current.halt.setHalted(true));
    act(() => {
      result.current.dispatch({
        kind: "resume",
        icon: "▶",
        label: "resume",
        detail: "",
        raw: "resume",
      });
    });
    expect(result.current.halt.halted).toBe(false);
  });

  it("halt flips halt true (no auto-resume)", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "halt",
        icon: "⏹",
        label: "halt",
        detail: "",
        raw: "halt",
      });
    });
    expect(result.current.halt.halted).toBe(true);
  });

  it("rule routes to /settings?focus=rules", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "rule",
        icon: "⊘",
        label: "rule change",
        detail: "stop offering founder rate",
        raw: "stop offering founder rate",
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/settings?focus=rules");
  });

  it("handoff with threadContext routes to /contacts/[id]?takeover=true", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch(
        {
          kind: "handoff",
          icon: "✎",
          label: "handoff · Maya",
          detail: "",
          raw: "reply to Maya",
        },
        { contactId: "c1", displayName: "Maya" },
      );
    });
    expect(pushMock).toHaveBeenCalledWith("/contacts/c1?takeover=true");
  });

  it("handoff without threadContext toasts a fallback (no route)", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "handoff",
        icon: "✎",
        label: "handoff · Maya",
        detail: "",
        raw: "reply to Maya",
      });
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledOnce();
  });

  it("context with threadContext routes to /contacts/[id]?note=open", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch(
        {
          kind: "context",
          icon: "ⓘ",
          label: "context · Maya",
          detail: "",
          raw: "tell alex about Maya",
        },
        { contactId: "c1", displayName: "Maya" },
      );
    });
    expect(pushMock).toHaveBeenCalledWith("/contacts/c1?note=open");
  });

  it("brief is toast-only stub", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "brief",
        icon: "☼",
        label: "brief me",
        detail: "at noon",
        raw: "brief me at noon",
      });
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledOnce();
  });

  it("command pause-1h flips halt true via synthetic parseCommand", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "command",
        icon: "·",
        label: "Pause Alex for 1 hour",
        detail: "",
        raw: "",
        commandId: "pause-1h",
      });
    });
    expect(result.current.halt.halted).toBe(true);
  });

  it("command stop-founder routes with founderRateEnabled=false", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "command",
        icon: "·",
        label: "Stop offering the founder rate",
        detail: "",
        raw: "",
        commandId: "stop-founder",
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/settings?focus=rules&founderRateEnabled=false");
  });

  it("command raise-rule routes with priceApprovalThreshold=99", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "command",
        icon: "·",
        label: "Raise approval threshold to $99",
        detail: "",
        raw: "",
        commandId: "raise-rule",
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/settings?focus=rules&priceApprovalThreshold=99");
  });

  it("command open-settings routes to /settings", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "command",
        icon: "·",
        label: "Open settings",
        detail: "",
        raw: "",
        commandId: "open-settings",
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/settings");
  });

  it("command open-meta routes to /settings?focus=channels", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "command",
        icon: "·",
        label: "Open Meta Ads campaigns",
        detail: "",
        raw: "",
        commandId: "open-meta",
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/settings?focus=channels");
  });

  it("thread-group commandId without threadContext is a no-op (no toast, no route)", () => {
    // Defensive against the catalog/dispatcher asymmetry:
    // fu-named/reply-named/hold-named labels carry literal `{contact}` tokens.
    // Palette filters them out when threadContext is undefined; this guards
    // direct dispatcher invocations.
    const { result } = setup();
    for (const id of ["fu-named", "reply-named", "hold-named"]) {
      act(() => {
        result.current.dispatch({
          kind: "command",
          icon: "·",
          label: `placeholder · {contact}`,
          detail: "",
          raw: "",
          commandId: id,
        });
      });
    }
    expect(toastMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("resume works even when currently halted", () => {
    const { result } = setup();
    act(() => result.current.halt.setHalted(true));
    expect(result.current.halt.halted).toBe(true);
    act(() => {
      result.current.dispatch({
        kind: "resume",
        icon: "▶",
        label: "resume",
        detail: "",
        raw: "",
      });
    });
    expect(result.current.halt.halted).toBe(false);
  });
});
