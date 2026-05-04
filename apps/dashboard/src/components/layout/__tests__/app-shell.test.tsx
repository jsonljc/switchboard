import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AppShell, CHROME_HIDDEN_PATHS } from "../app-shell.js";

const pathnameRef = { current: "/dashboard" };

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: () => ({ data: { config: { onboardingComplete: true } }, isLoading: false }),
}));

vi.mock("@/components/layout/owner-shell", () => ({
  OwnerShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="owner-shell">{children}</div>
  ),
}));

vi.mock("next/dynamic", () => ({
  default: (_loader: () => Promise<{ DevPanel: React.FC }>) => {
    // Return a simple wrapper that renders nothing in tests
    const Component = () => <div data-testid="dev-panel" />;
    Component.displayName = "DynamicDevPanel";
    return Component;
  },
}));

describe("AppShell", () => {
  it("always renders OwnerShell for authenticated routes", () => {
    render(
      <AppShell>
        <span>content</span>
      </AppShell>,
    );
    expect(screen.getByTestId("owner-shell")).toBeDefined();
    expect(screen.getByText("content")).toBeDefined();
  });

  it("does not render StaffShell", () => {
    render(
      <AppShell>
        <span>content</span>
      </AppShell>,
    );
    expect(screen.queryByTestId("staff-shell")).toBeNull();
  });
});

describe("app-shell CHROME_HIDDEN_PATHS", () => {
  it("does not include /console (operator's home at v1; needs OwnerTabs)", () => {
    expect(CHROME_HIDDEN_PATHS).not.toContain("/console");
  });

  it("still hides chrome for /login, /onboarding, /setup", () => {
    expect(CHROME_HIDDEN_PATHS).toContain("/login");
    expect(CHROME_HIDDEN_PATHS).toContain("/onboarding");
    expect(CHROME_HIDDEN_PATHS).toContain("/setup");
  });

  it("hides chrome for /reports (Mercury register supplies its own header)", () => {
    expect(CHROME_HIDDEN_PATHS).toContain("/reports");
  });
});

describe("AppShell editorial passthrough", () => {
  it("does not mount OwnerShell on /alex (editorial shell owns chrome)", () => {
    pathnameRef.current = "/alex";
    render(
      <AppShell>
        <span>editorial-content</span>
      </AppShell>,
    );
    expect(screen.queryByTestId("owner-shell")).toBeNull();
    expect(screen.getByText("editorial-content")).toBeDefined();
    pathnameRef.current = "/dashboard";
  });

  it("does not mount OwnerShell on /riley", () => {
    pathnameRef.current = "/riley";
    render(
      <AppShell>
        <span>editorial-content</span>
      </AppShell>,
    );
    expect(screen.queryByTestId("owner-shell")).toBeNull();
    pathnameRef.current = "/dashboard";
  });

  it("does not mount OwnerShell on / (Owner Home placeholder)", () => {
    pathnameRef.current = "/";
    render(
      <AppShell>
        <span>editorial-content</span>
      </AppShell>,
    );
    expect(screen.queryByTestId("owner-shell")).toBeNull();
    pathnameRef.current = "/dashboard";
  });

  it("does not wrap editorial routes in <main> (the editorial shell does)", () => {
    pathnameRef.current = "/alex";
    const { container } = render(
      <AppShell>
        <span>editorial-content</span>
      </AppShell>,
    );
    expect(container.querySelector("main")).toBeNull();
    pathnameRef.current = "/dashboard";
  });
});
