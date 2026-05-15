import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRileyActionDispatcher } from "../riley-action-dispatcher";
import { RILEY_COMMANDS } from "../riley/riley-config";
import type { RileyCommand } from "../riley/riley-config";

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

function cmd(id: string): RileyCommand {
  const found = RILEY_COMMANDS.find((c) => c.id === id);
  if (!found) throw new Error(`unknown RILEY_COMMANDS id: ${id}`);
  return found;
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
      act(() => result.current(c));
      expect(toast).toHaveBeenCalledTimes(1);
    }
  });

  it("dispatching every command covers all of RILEY_COMMANDS", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    for (const c of RILEY_COMMANDS) {
      toast.mockReset();
      act(() => result.current(c));
      expect(toast).toHaveBeenCalledTimes(1);
    }
  });
});
