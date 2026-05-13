import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolsOverflow, TOOLS_NAV_ITEMS } from "../tools-overflow";

describe("TOOLS_NAV_ITEMS", () => {
  it("includes an Approvals entry", () => {
    const approvals = TOOLS_NAV_ITEMS.find((i) => i.id === "approvals");
    expect(approvals).toEqual({
      id: "approvals",
      label: "Approvals",
      href: "/approvals",
    });
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
  vi.stubEnv("NEXT_PUBLIC_APPROVALS_LIVE", value ? "true" : "");
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
  it("opens the menu and lists all five Tools items + Settings with separator", async () => {
    setAllToolsLive(true);
    render(<ToolsOverflow />);
    await openMenu();
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((el) => el.textContent)).toEqual([
      "Contacts",
      "Automations",
      "Activity",
      "Reports",
      "Approvals",
      "Settings",
    ]);
    // Separator between Approvals and Settings.
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
  });

  // Case 3
  it("hides Automations when its flag is false; the other four Tools items remain visible", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACTS_LIVE", "true");
    vi.stubEnv("NEXT_PUBLIC_AUTOMATIONS_LIVE", "");
    vi.stubEnv("NEXT_PUBLIC_ACTIVITY_LIVE", "true");
    vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", "true");
    vi.stubEnv("NEXT_PUBLIC_APPROVALS_LIVE", "true");
    render(<ToolsOverflow />);
    await openMenu();
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Automations")).not.toBeInTheDocument();
    expect(within(menu).getByText("Contacts")).toBeInTheDocument();
    expect(within(menu).getByText("Activity")).toBeInTheDocument();
    expect(within(menu).getByText("Reports")).toBeInTheDocument();
    expect(within(menu).getByText("Approvals")).toBeInTheDocument();
  });

  // Case 4
  it("hides the entire trigger when all five flags are off", () => {
    setAllToolsLive(false);
    const { container } = render(<ToolsOverflow />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: /tools/i })).not.toBeInTheDocument();
  });

  // Case 5
  it.each([
    ["/contacts"],
    ["/contacts/abc"],
    ["/automations"],
    ["/automations/xyz"],
    ["/activity"],
    ["/reports"],
    ["/approvals"],
    ["/approvals/abc"],
  ])("trigger has data-on-tools when pathname is %s", (pathname) => {
    setAllToolsLive(true);
    mockUsePathname.mockReturnValue(pathname);
    render(<ToolsOverflow />);
    const trigger = screen.getByRole("button", { name: /tools/i });
    expect(trigger).toHaveAttribute("data-on-tools", "true");
  });

  // Case 6
  it("trigger does NOT have data-on-tools when pathname is /settings", () => {
    setAllToolsLive(true);
    mockUsePathname.mockReturnValue("/settings");
    render(<ToolsOverflow />);
    const trigger = screen.getByRole("button", { name: /tools/i });
    expect(trigger).not.toHaveAttribute("data-on-tools");
  });

  // Case 7
  it.each([["/"], ["/alex"], ["/missing"]])(
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
    ["/contacts-old", "Contacts"],
    ["/reports-archive", "Reports"],
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
    ["/contacts", "Contacts"],
    ["/automations", "Automations"],
    ["/activity", "Activity"],
    ["/reports", "Reports"],
    ["/approvals", "Approvals"],
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
