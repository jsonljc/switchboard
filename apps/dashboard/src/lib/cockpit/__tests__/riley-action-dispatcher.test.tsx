import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRileyActionDispatcher } from "../riley-action-dispatcher";
import { RILEY_COMMANDS } from "../riley/riley-config";
import { parseCommand } from "../parse-command";
import type { ParsedAction } from "@/components/cockpit/types";

const setHalted = vi.fn();
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, setHalted, toggleHalt: vi.fn() }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const toast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast }),
}));

function cmd(id: string): ParsedAction {
  const found = RILEY_COMMANDS.find((c) => c.id === id);
  if (!found) throw new Error(`unknown RILEY_COMMANDS id: ${id}`);
  return {
    kind: "command",
    icon: "·",
    label: found.label,
    detail: "",
    raw: "",
    commandId: found.id,
  };
}

describe("useRileyActionDispatcher", () => {
  let onShowMission: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setHalted.mockReset();
    push.mockReset();
    toast.mockReset();
    onShowMission = vi.fn();
  });

  it("open-meta routes to /settings?focus=channels and toasts", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("open-meta")));
    expect(push).toHaveBeenCalledWith("/settings?focus=channels");
    expect(toast).toHaveBeenCalledWith({ title: "Opening Meta connection." });
    expect(onShowMission).not.toHaveBeenCalled();
    expect(setHalted).not.toHaveBeenCalled();
  });

  it("open-rules routes to /settings?focus=rules and toasts", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("open-rules")));
    expect(push).toHaveBeenCalledWith("/settings?focus=rules");
    expect(toast).toHaveBeenCalledWith({ title: "Opening rules." });
  });

  it("open-targets invokes onShowMission callback (force-open, not toggle) and toasts", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("open-targets")));
    expect(onShowMission).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: "Opened targets." });
  });

  it("pause-1h calls setHalted(true) and toasts with wall-clock projection", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("pause-1h")));
    expect(setHalted).toHaveBeenCalledWith(true);
    expect(toast).toHaveBeenCalledTimes(1);
    const payload = toast.mock.calls[0]![0] as { title: string; description?: string };
    expect(payload.title).toBe("Paused — standing by.");
    expect(payload.description).toMatch(/^until /);
  });

  it("resume calls setHalted(false) and toasts Riley copy", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("resume")));
    expect(setHalted).toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledWith({ title: "Resumed — back to scanning." });
  });

  it("brief-eod is a toast-only stub (no side effects)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("brief-eod")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(onShowMission).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: "Noted — brief stub.",
      description: "I'll surface scheduled briefs when that ships.",
    });
  });

  it("cpl-30 is a toast-only stub (no side effects)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("cpl-30")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: "Noted — CPL stub.",
      description: "I'll surface CPL trends when that ships.",
    });
  });

  it("fires exactly one toast per dispatch (single-owner doctrine)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    for (const c of RILEY_COMMANDS) {
      toast.mockReset();
      act(() => result.current(cmd(c.id)));
      expect(toast).toHaveBeenCalledTimes(1);
    }
  });

  it("dispatching every command covers all of RILEY_COMMANDS", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    for (const c of RILEY_COMMANDS) {
      toast.mockReset();
      act(() => result.current(cmd(c.id)));
      expect(toast).toHaveBeenCalledTimes(1);
    }
  });
});

describe("useRileyActionDispatcher — composer path (ParsedAction)", () => {
  let onShowMission: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setHalted.mockReset();
    push.mockReset();
    toast.mockReset();
    onShowMission = vi.fn();
  });

  it("pause kind: setHalted(true) + toastVoice projection", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("pause for 1h")));
    expect(setHalted).toHaveBeenCalledWith(true);
    expect(toast).toHaveBeenCalledTimes(1);
    const payload = toast.mock.calls[0]![0] as { title: string; description?: string };
    expect(payload.title).toBe("Paused — standing by.");
    expect(payload.description).toMatch(/^until /);
  });

  it("resume kind: setHalted(false) + Riley copy", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("resume")));
    expect(setHalted).toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledWith({ title: "Resumed — back to scanning." });
  });

  it("halt kind: setHalted(true) + Alex toastVoice", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("halt")));
    expect(setHalted).toHaveBeenCalledWith(true);
    expect(toast).toHaveBeenCalledWith({ title: "Halted — stopped everything." });
  });

  it("brief kind: toast-only stub", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("brief me at EOD")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: "Noted — brief stub.",
      description: "I'll surface scheduled briefs when that ships.",
    });
  });

  it("rule kind: router.push + toastVoice", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("stop offering free consults")));
    expect(push).toHaveBeenCalledWith("/settings?focus=rules");
    expect(toast).toHaveBeenCalledTimes(1);
    const payload = toast.mock.calls[0]![0] as { title: string };
    expect(payload.title).toBe("Opening rules.");
  });

  it("followup kind folds into instruction toast (no side effects)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("follow up with Maya tonight")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    const payload = toast.mock.calls[0]![0] as { title: string; description: string };
    expect(payload.title).toBe("Got it.");
    expect(payload.description).toMatch(/Acting on/);
  });

  it("handoff kind folds into instruction toast (no side effects)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("reply to Maya")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(toast.mock.calls[0]![0]).toMatchObject({ title: "Got it." });
  });

  it("context kind folds into instruction toast (no side effects)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("tell alex about Maya")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(toast.mock.calls[0]![0]).toMatchObject({ title: "Got it." });
  });

  it("instruction kind (ad-ops free-form): toast-only, no side effects", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("raise daily budget to $200")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    const payload = toast.mock.calls[0]![0] as { title: string; description: string };
    expect(payload.title).toBe("Got it.");
    expect(payload.description).toContain('Acting on "raise daily budget to $200".');
  });

  it("composer path fires exactly one toast per dispatch (single-owner doctrine)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    const phrases = [
      "pause for 1h",
      "resume",
      "halt",
      "brief me",
      "stop offering X",
      "follow up with Y",
      "reply to Y",
      "tell alex about Y",
      "raise daily budget to $200",
    ];
    for (const phrase of phrases) {
      toast.mockReset();
      act(() => result.current(parseCommand(phrase)));
      expect(toast).toHaveBeenCalledTimes(1);
    }
  });
});
