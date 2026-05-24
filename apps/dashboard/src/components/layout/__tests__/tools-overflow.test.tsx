import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolsOverflow, TOOLS_NAV_ITEMS } from "../tools-overflow";

describe("TOOLS_NAV_ITEMS", () => {
  it("does not include an Approvals entry (standalone queue removed)", () => {
    expect(TOOLS_NAV_ITEMS.find((i) => i.id === "approvals")).toBeUndefined();
  });

  it("does not include an Activity entry (audit viewer kept reachable by URL, removed from SMB nav)", () => {
    expect(TOOLS_NAV_ITEMS.find((i) => i.id === "activity")).toBeUndefined();
  });
});

// Mock next/navigation. Each test sets the return value via mockReturnValue.
const mockUsePathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

function setAllToolsLive(value: boolean) {
  vi.stubEnv("NEXT_PUBLIC_CONTACTS_LIVE", value ? "true" : "");
  vi.stubEnv("NEXT_PUBLIC_AUTOMATIONS_LIVE", value ? "true" : "");
  vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", value ? "true" : "");
  vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", value ? "true" : "");
}

async function openMenu() {
  const trigger = screen.getByRole("button", { name: /tools/i });
  await userEvent.click(trigger);
  return trigger;
}

beforeEach(() => {
  mockUsePathname.mockReturnValue("/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ToolsOverflow", () => {
  // Case 1
  it("renders a trigger labelled 'Tools'", () => {
    setAllToolsLive(true);
    render(<ToolsOverflow />);
    expect(screen.getByRole("button", { name: /tools/i })).toBeInTheDocument();
  });

  // Case 2
  it("opens the menu and lists the three Tools items + Settings with separator", async () => {
    setAllToolsLive(true);
    render(<ToolsOverflow />);
    await openMenu();
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((el) => el.textContent)).toEqual([
      "Pipeline",
      "Automations",
      "Reports",
      "Settings",
    ]);
    // Activity is intentionally not in the nav (kept reachable by URL only).
    expect(within(menu).queryByText("Activity")).not.toBeInTheDocument();
    // Separator between Reports and Settings.
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
  });

  // Case 3
  it("hides Automations when its flag is false; the other Tools items remain visible", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACTS_LIVE", "true");
    vi.stubEnv("NEXT_PUBLIC_AUTOMATIONS_LIVE", "");
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
    vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", "true");
    render(<ToolsOverflow />);
    await openMenu();
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Automations")).not.toBeInTheDocument();
    expect(within(menu).getByText("Pipeline")).toBeInTheDocument();
    expect(within(menu).getByText("Reports")).toBeInTheDocument();
  });

  // Case 4
  it("hides the entire trigger when all four flags are off", () => {
    setAllToolsLive(false);
    const { container } = render(<ToolsOverflow />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: /tools/i })).not.toBeInTheDocument();
  });

  // Case 5
  it.each([["/contacts"], ["/contacts/abc"], ["/automations"], ["/automations/xyz"], ["/results"]])(
    "trigger has data-on-tools when pathname is %s",
    (pathname) => {
      setAllToolsLive(true);
      mockUsePathname.mockReturnValue(pathname);
      render(<ToolsOverflow />);
      const trigger = screen.getByRole("button", { name: /tools/i });
      expect(trigger).toHaveAttribute("data-on-tools", "true");
    },
  );

  // Case 6
  it("trigger does NOT have data-on-tools when pathname is /settings", () => {
    setAllToolsLive(true);
    mockUsePathname.mockReturnValue("/settings");
    render(<ToolsOverflow />);
    const trigger = screen.getByRole("button", { name: /tools/i });
    expect(trigger).not.toHaveAttribute("data-on-tools");
  });

  // Case 7
  // "/activity" is included here on purpose: it is no longer a Tools route, so
  // visiting it must NOT light the Tools trigger.
  it.each([["/"], ["/alex"], ["/missing"], ["/activity"]])(
    "trigger does NOT have data-on-tools when pathname is %s",
    (pathname) => {
      setAllToolsLive(true);
      mockUsePathname.mockReturnValue(pathname);
      render(<ToolsOverflow />);
      const trigger = screen.getByRole("button", { name: /tools/i });
      expect(trigger).not.toHaveAttribute("data-on-tools");
    },
  );

  // Case 8
  it.each([
    ["/contacts-old", "Pipeline"],
    ["/results-archive", "Reports"],
    ["/settingsness", "Settings"],
  ])("boundary matching: pathname %s does not activate %s", async (pathname, label) => {
    setAllToolsLive(true);
    mockUsePathname.mockReturnValue(pathname);
    render(<ToolsOverflow />);
    const trigger = screen.getByRole("button", { name: /tools/i });
    // Trigger must not be marked active for the spurious match
    // (only valid for the four Tools prefixes; /settingsness is irrelevant here).
    if (label !== "Settings") {
      expect(trigger).not.toHaveAttribute("data-on-tools");
    }
    await userEvent.click(trigger);
    const menu = await screen.findByRole("menu");
    const item = within(menu).getByText(label).closest('[role="menuitem"]');
    expect(item).not.toHaveAttribute("data-active");
  });

  // Case 9
  it.each([["/settings"], ["/settings/account"]])(
    "Settings menu item is active+aria-current when pathname is %s",
    async (pathname) => {
      setAllToolsLive(true);
      mockUsePathname.mockReturnValue(pathname);
      render(<ToolsOverflow />);
      await openMenu();
      const menu = await screen.findByRole("menu");
      const settings = within(menu).getByText("Settings");
      const item = settings.closest('[role="menuitem"]');
      expect(item).toHaveAttribute("data-active", "true");
      // aria-current="page" lives on the inner <Link>.
      expect(settings.closest("a")).toHaveAttribute("aria-current", "page");
    },
  );

  // Case 10
  it.each([
    ["/contacts", "Pipeline"],
    ["/automations", "Automations"],
    ["/results", "Reports"],
  ])("%s item is active+aria-current when pathname matches", async (pathname, label) => {
    setAllToolsLive(true);
    mockUsePathname.mockReturnValue(pathname);
    render(<ToolsOverflow />);
    await openMenu();
    const menu = await screen.findByRole("menu");
    const text = within(menu).getByText(label);
    const item = text.closest('[role="menuitem"]');
    expect(item).toHaveAttribute("data-active", "true");
    expect(text.closest("a")).toHaveAttribute("aria-current", "page");
  });

  // Case 11
  it("no menu item has aria-current when pathname is on no Tools/Settings route", async () => {
    setAllToolsLive(true);
    mockUsePathname.mockReturnValue("/alex");
    render(<ToolsOverflow />);
    await openMenu();
    const menu = await screen.findByRole("menu");
    // With shadcn DropdownMenuItem `asChild`, the menuitem role is forwarded
    // onto the inner <Link>/<a>; the menuitem element IS the anchor, so
    // assert directly on it (mirrors Case 10's `text.closest("a")` pattern).
    const items = within(menu).getAllByRole("menuitem");
    for (const item of items) {
      expect(item).not.toHaveAttribute("aria-current");
    }
  });
});
