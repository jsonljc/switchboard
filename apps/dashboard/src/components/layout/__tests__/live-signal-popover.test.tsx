// apps/dashboard/src/components/layout/__tests__/live-signal-popover.test.tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { useAudit } from "@/hooks/use-audit";
import type { AuditEntryResponse } from "@/hooks/use-audit";
import { LiveSignalPopover } from "../live-signal-popover";

// Tool B: mock useHalt directly — the popover doesn't care about provider
// internals; we need to drive `error` from outside for the toast test.
const haltState = {
  halted: false,
  isPending: false,
  error: null as Error | null,
  setHalted: vi.fn(),
  toggleHalt: vi.fn(),
};
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ ...haltState }),
  HaltProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Mock useToast so we can assert toast calls without a real toast stack.
const toastMock = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/hooks/use-audit", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-audit")>("@/hooks/use-audit");
  return {
    ...actual,
    useAudit: vi.fn(),
  };
});

function makeEntry(overrides: Partial<AuditEntryResponse> = {}): AuditEntryResponse {
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2, 8)}`,
    eventType: overrides.eventType ?? "alex.action.taken",
    timestamp: overrides.timestamp ?? "2026-05-08T12:00:00.000Z",
    actorType: "agent",
    actorId: overrides.actorId ?? "alex",
    entityType: "decision",
    entityId: "d-1",
    riskCategory: "low",
    summary: overrides.summary ?? "did a thing",
    snapshot: {},
    envelopeId: null,
    ...overrides,
  };
}

function setUseAudit(opts: {
  isLoading?: boolean;
  isError?: boolean;
  entries?: AuditEntryResponse[];
  dataError?: string;
}) {
  const data =
    opts.entries || opts.dataError
      ? { entries: opts.entries ?? [], total: opts.entries?.length ?? 0, error: opts.dataError }
      : undefined;
  vi.mocked(useAudit).mockReturnValue({
    data,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    error: null,
    refetch: vi.fn(),
    // The following fields are required by the React Query return type but not exercised here.
  } as unknown as ReturnType<typeof useAudit>);
}

function renderPopover({ initialHalted = false }: { initialHalted?: boolean } = {}) {
  haltState.halted = initialHalted;
  haltState.error = null;
  return render(<LiveSignalPopover />);
}

beforeEach(() => {
  haltState.halted = false;
  haltState.isPending = false;
  haltState.error = null;
  haltState.setHalted = vi.fn();
  haltState.toggleHalt = vi.fn();
  vi.mocked(useAudit).mockReset();
  toastMock.mockReset();
  setUseAudit({ entries: [] });
});

describe("LiveSignalPopover — pip (trigger)", () => {
  it("preserves the existing live-pip DOM contract", () => {
    setUseAudit({ entries: [] });
    const { container } = renderPopover();
    const pip = container.querySelector("button.live-pip");
    expect(pip).not.toBeNull();
    expect(pip!.querySelector("span.pulse")).not.toBeNull();
    expect(pip!.textContent).toContain("Live");
  });

  it("aria-label reads 'System live — open live signal' when not halted", () => {
    renderPopover({ initialHalted: false });
    const pip = screen.getByRole("button", { name: /system live/i });
    expect(pip).toHaveAttribute("aria-label", "System live — open live signal");
  });

  it("aria-label reads 'System halted — open live signal' when halted", () => {
    renderPopover({ initialHalted: true });
    const pip = screen.getByRole("button", { name: /system halted/i });
    expect(pip).toHaveAttribute("aria-label", "System halted — open live signal");
  });

  it("trigger has 'live-pip halted' class when halted", () => {
    const { container } = renderPopover({ initialHalted: true });
    const pip = container.querySelector("button.live-pip");
    expect(pip).not.toBeNull();
    expect(pip!.className).toContain("halted");
  });
});

describe("LiveSignalPopover — halt action", () => {
  it("flips state and labels in lockstep when Halt is clicked", async () => {
    const user = userEvent.setup();
    haltState.halted = false;
    haltState.toggleHalt = vi.fn(() => {
      haltState.halted = true;
    });
    const { container, rerender } = render(<LiveSignalPopover />);
    await user.click(screen.getByRole("button", { name: /system live/i }));

    const halt = await screen.findByRole("button", { name: /^Halt$/ });
    await user.click(halt);

    // Rerender so the new halted state is reflected in the DOM
    rerender(<LiveSignalPopover />);

    expect(container.querySelector("button.live-pip")!.textContent).toContain("Halted");
    expect(within(screen.getByRole("dialog")).getByText(/system halted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Resume$/ })).toBeInTheDocument();
  });

  it("Resume from halted flips state back", async () => {
    const user = userEvent.setup();
    haltState.halted = true;
    haltState.toggleHalt = vi.fn(() => {
      haltState.halted = false;
    });
    const { rerender } = render(<LiveSignalPopover />);
    await user.click(screen.getByRole("button", { name: /system halted/i }));
    await user.click(screen.getByRole("button", { name: /^Resume$/ }));
    rerender(<LiveSignalPopover />);
    // toggleHalt was called — state flip happens in the mock
    expect(haltState.toggleHalt).toHaveBeenCalledOnce();
  });
});

describe("LiveSignalPopover — popover does not auto-close on halt", () => {
  it("popover stays open after Halt click", async () => {
    const user = userEvent.setup();
    renderPopover({ initialHalted: false });
    await user.click(screen.getByRole("button", { name: /system live/i }));
    await user.click(await screen.findByRole("button", { name: /^Halt$/ }));
    // Popover still open
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("LiveSignalPopover — recent activity preview", () => {
  it("caps rendered events at 10", async () => {
    const user = userEvent.setup();
    setUseAudit({
      entries: Array.from({ length: 25 }, (_, i) =>
        makeEntry({
          id: `e-${i}`,
          timestamp: new Date(Date.UTC(2026, 4, 8, 12, 0, 25 - i)).toISOString(),
        }),
      ),
    });
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    const list = within(screen.getByRole("dialog")).getByRole("list");
    expect(list.querySelectorAll("li").length).toBe(10);
  });

  it("renders 'Reading the trail…' while loading with no cached data", async () => {
    const user = userEvent.setup();
    setUseAudit({ isLoading: true });
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    expect(within(screen.getByRole("dialog")).getByText(/reading the trail/i)).toBeInTheDocument();
    // Status header + Halt button still render
    expect(screen.getByRole("button", { name: /^Halt$/ })).toBeInTheDocument();
  });

  it("renders 'Couldn't load activity.' on error", async () => {
    const user = userEvent.setup();
    setUseAudit({ isError: true });
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    expect(
      within(screen.getByRole("dialog")).getByText(/couldn't load activity/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Halt$/ })).toBeInTheDocument();
  });

  it("renders 'Couldn't load activity.' when audit returns 200 with data.error (backend unreachable)", async () => {
    const user = userEvent.setup();
    setUseAudit({ dataError: "Failed to load activity" });
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    expect(
      within(screen.getByRole("dialog")).getByText(/couldn't load activity/i),
    ).toBeInTheDocument();
    // Empty-state copy must NOT appear when the data error path fires.
    expect(within(screen.getByRole("dialog")).queryByText(/nothing to report/i)).toBeNull();
  });

  it("renders 'Nothing to report.' when entries is empty", async () => {
    const user = userEvent.setup();
    setUseAudit({ entries: [] });
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    expect(within(screen.getByRole("dialog")).getByText(/nothing to report/i)).toBeInTheDocument();
  });

  it("event rows are read-only — no <a> or <button> descendants in row", async () => {
    const user = userEvent.setup();
    setUseAudit({ entries: [makeEntry({ id: "only-one", summary: "did a thing" })] });
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    const dialog = screen.getByRole("dialog");
    const list = within(dialog).getByRole("list");
    const items = list.querySelectorAll("li");
    expect(items.length).toBe(1);
    expect(items[0].querySelector("a")).toBeNull();
    expect(items[0].querySelector("button")).toBeNull();
  });
});

describe("LiveSignalPopover — accessibility", () => {
  it("Esc closes the popover", async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("popover content has accessible name 'Live signal'", async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Live signal");
  });
});

describe("LiveSignalPopover — resume readiness error toast", () => {
  it("fires 'Couldn't resume' toast when halted=true and error is set (failed resume)", () => {
    const err = new Error("Cannot resume — blockers: Meta Ads");
    haltState.halted = true; // failed resume → rolled back to halted
    haltState.error = err;
    render(<LiveSignalPopover />);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't resume",
        description: err.message,
        variant: "destructive",
      }),
    );
  });

  it("fires 'Couldn't pause' toast when halted=false and error is set (failed halt)", () => {
    const err = new Error("Cannot pause — server rejected");
    haltState.halted = false; // failed halt → rolled back to live
    haltState.error = err;
    render(<LiveSignalPopover />);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't pause",
        description: err.message,
        variant: "destructive",
      }),
    );
  });

  it("does not fire a toast when error is null", () => {
    haltState.error = null;
    render(<LiveSignalPopover />);
    expect(toastMock).not.toHaveBeenCalled();
  });

  // Pins the re-fire contract: use-governance throws a FRESH Error instance per
  // failure (new object identity), with react-query passing null between runs.
  // A future refactor that memoizes the error would silently break this behavior.
  it("re-fires the toast for each distinct Error instance (null between fires)", () => {
    const err1 = new Error("Cannot resume — blockers: Meta Ads");
    const err2 = new Error("Cannot resume — blockers: Meta Ads"); // distinct instance, same message
    haltState.halted = true;
    haltState.error = err1;

    const { rerender } = render(<LiveSignalPopover />);
    // First non-null error: toast fires once
    expect(toastMock).toHaveBeenCalledTimes(1);

    // Null between runs (react-query clears error between mutations)
    haltState.error = null;
    rerender(<LiveSignalPopover />);
    expect(toastMock).toHaveBeenCalledTimes(1); // no additional call for null

    // Second distinct Error instance: toast fires again
    haltState.error = err2;
    rerender(<LiveSignalPopover />);
    expect(toastMock).toHaveBeenCalledTimes(2);
  });
});
