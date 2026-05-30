import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { accountMenuLinks, AccountMenu } from "../account-menu";

const mockSignOut = vi.fn();
vi.mock("@/lib/sign-out", () => ({ signOut: (...args: unknown[]) => mockSignOut(...args) }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "ava@glowclinic.co" } }, status: "authenticated" }),
}));
vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: () => ({ data: { config: { name: "Glow Clinic" } } }),
}));

function renderMenu() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AccountMenu />
    </QueryClientProvider>,
  );
}

describe("accountMenuLinks", () => {
  it("always includes Account", () => {
    expect(accountMenuLinks(false).map((l) => l.href)).toContain("/settings/account");
  });

  it("includes Billing only when Stripe is configured", () => {
    expect(accountMenuLinks(false).some((l) => l.href === "/settings/billing")).toBe(false);
    expect(accountMenuLinks(true).some((l) => l.href === "/settings/billing")).toBe(true);
  });
});

describe("AccountMenu", () => {
  it("opens to the org/email header, Account, and Sign out", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Glow Clinic")).toBeInTheDocument();
    expect(within(menu).getByText("ava@glowclinic.co")).toBeInTheDocument();
    expect(within(menu).getByText("Account")).toBeInTheDocument();
    expect(within(menu).getByText(/sign out/i)).toBeInTheDocument();
  });

  it("invokes sign-out when Sign out is selected", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const menu = await screen.findByRole("menu");
    await userEvent.click(within(menu).getByText(/sign out/i));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
