// apps/dashboard/src/components/layout/__tests__/live-signal-popover.test.tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HaltProvider } from "../halt/halt-context";
import { LiveSignalPopover } from "../live-signal-popover";
import type { AuditEntryResponse } from "@/hooks/use-audit";

vi.mock("@/hooks/use-audit", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-audit")>("@/hooks/use-audit");
  return {
    ...actual,
    useAudit: vi.fn(),
  };
});

import { useAudit } from "@/hooks/use-audit";

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
  if (initialHalted) {
    window.localStorage.setItem("sb_halt_state", "1");
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HaltProvider>
        <LiveSignalPopover />
      </HaltProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(useAudit).mockReset();
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
    const { container } = renderPopover({ initialHalted: false });
    await user.click(screen.getByRole("button", { name: /system live/i }));

    const halt = await screen.findByRole("button", { name: /^Halt$/ });
    await user.click(halt);

    // After click: pip text now Halted; popover label flips
    expect(container.querySelector("button.live-pip")!.textContent).toContain("Halted");
    expect(within(screen.getByRole("dialog")).getByText(/system halted/i)).toBeInTheDocument();
    // Halt button label flips to Resume
    expect(screen.getByRole("button", { name: /^Resume$/ })).toBeInTheDocument();
    expect(window.localStorage.getItem("sb_halt_state")).toBe("1");
  });

  it("Resume from halted flips state back", async () => {
    const user = userEvent.setup();
    renderPopover({ initialHalted: true });
    await user.click(screen.getByRole("button", { name: /system halted/i }));
    await user.click(screen.getByRole("button", { name: /^Resume$/ }));
    expect(window.localStorage.getItem("sb_halt_state")).toBe("0");
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
