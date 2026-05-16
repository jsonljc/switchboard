import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppShell, ONBOARDING_EXEMPT_PATHS } from "../app-shell";

const pathnameRef = { current: "/contacts" };
const replaceMock = vi.fn();
const orgConfigMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: (enabled?: boolean) => orgConfigMock(enabled),
}));

const devPanelProps: { current: Record<string, unknown> } = { current: {} };

vi.mock("next/dynamic", () => ({
  default: (_loader: () => Promise<{ DevPanel: React.FC<Record<string, unknown>> }>) => {
    const Component = (props: Record<string, unknown>) => {
      devPanelProps.current = props;
      return <div data-testid="dev-panel" />;
    };
    Component.displayName = "DynamicDevPanel";
    return Component;
  },
}));

vi.mock("../data-mode-banner", () => ({
  DataModeBanner: () => <div data-testid="data-mode-banner" />,
}));

beforeEach(() => {
  pathnameRef.current = "/contacts";
  replaceMock.mockReset();
  orgConfigMock.mockReset();
  orgConfigMock.mockReturnValue({
    data: { config: { onboardingComplete: true } },
    isLoading: false,
  });
});

describe("AppShell visual branches", () => {
  it("renders editorial paths without a wrapper <main>", () => {
    pathnameRef.current = "/alex";
    const { container } = render(
      <AppShell>
        <span>editorial-content</span>
      </AppShell>,
    );
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByText("editorial-content")).toBeDefined();
  });

  it("renders Mercury paths without a wrapper <main> (shell mounted via (mercury)/layout)", () => {
    pathnameRef.current = "/contacts";
    const { container } = render(
      <AppShell>
        <span>mercury-content</span>
      </AppShell>,
    );
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByText("mercury-content")).toBeDefined();
  });

  it("treats Mercury detail paths as shell-owned (prefix match)", () => {
    pathnameRef.current = "/contacts/abc-123";
    const { container } = render(
      <AppShell>
        <span>detail-content</span>
      </AppShell>,
    );
    expect(container.querySelector("main")).toBeNull();
  });

  it("wraps non-shell paths in a bare <main>", () => {
    pathnameRef.current = "/settings";
    const { container } = render(
      <AppShell>
        <span>settings-content</span>
      </AppShell>,
    );
    expect(container.querySelector("main")).not.toBeNull();
    expect(screen.getByText("settings-content")).toBeDefined();
  });

  it("does not match prefix-collisions (treats /contactsx as non-shell)", () => {
    // Guards the canonical `pathname === p || pathname.startsWith(p + "/")`
    // shape against an accidental drop of the trailing slash, which would
    // silently swallow paths that share a prefix with a Mercury surface.
    pathnameRef.current = "/contactsx";
    const { container } = render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(container.querySelector("main")).not.toBeNull();
  });

  it("source does not reference OwnerShell or OwnerTabs", () => {
    // Source-text guardrail against re-introducing legacy chrome via dynamic
    // import or string-keyed lookup. owner-shell.tsx is already deleted, so
    // a static import would also fail typecheck — this is defense-in-depth.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const source = fs.readFileSync(path.join(__dirname, "../app-shell.tsx"), "utf8");
    expect(source).not.toContain("OwnerShell");
    expect(source).not.toContain("OwnerTabs");
  });
});

describe("ONBOARDING_EXEMPT_PATHS membership (gating, not chrome)", () => {
  it("contains only login/onboarding/setup — not Mercury surfaces or settings", () => {
    expect(ONBOARDING_EXEMPT_PATHS).toEqual(["/login", "/onboarding", "/setup"]);
  });
});

describe("Onboarding-redirect behavior", () => {
  it("does not redirect while org-config is loading", () => {
    pathnameRef.current = "/contacts";
    orgConfigMock.mockReturnValue({ data: undefined, isLoading: true });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects from a Mercury surface when onboarding is incomplete", () => {
    pathnameRef.current = "/contacts";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).toHaveBeenCalledWith("/onboarding");
  });

  it("redirects from /settings when onboarding is incomplete", () => {
    pathnameRef.current = "/settings";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).toHaveBeenCalledWith("/onboarding");
  });

  it("does not redirect from /onboarding (exempt)", () => {
    pathnameRef.current = "/onboarding";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect from /login (exempt)", () => {
    pathnameRef.current = "/login";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect from editorial paths (existing behavior preserved)", () => {
    pathnameRef.current = "/alex";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect when onboarding is complete", () => {
    pathnameRef.current = "/contacts";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: true } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("skips org-config fetch on editorial paths", () => {
    pathnameRef.current = "/alex";
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(orgConfigMock).toHaveBeenCalledWith(false);
  });

  it("skips org-config fetch on onboarding-exempt paths", () => {
    pathnameRef.current = "/login";
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(orgConfigMock).toHaveBeenCalledWith(false);
  });

  it("fetches org-config on Mercury surfaces (gating active)", () => {
    pathnameRef.current = "/contacts";
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(orgConfigMock).toHaveBeenCalledWith(true);
  });
});

describe("AppShell — dataModeControlsAllowed prop forwarding", () => {
  it("forwards dataModeControlsAllowed=true to DevPanel in editorial branch", () => {
    pathnameRef.current = "/alex";
    render(
      <AppShell dataModeControlsAllowed={true}>
        <span>x</span>
      </AppShell>,
    );
    expect(devPanelProps.current.dataModeControlsAllowed).toBe(true);
  });

  it("forwards dataModeControlsAllowed=false to DevPanel in bare-main branch", () => {
    pathnameRef.current = "/settings";
    render(
      <AppShell dataModeControlsAllowed={false}>
        <span>x</span>
      </AppShell>,
    );
    expect(devPanelProps.current.dataModeControlsAllowed).toBe(false);
  });
});

describe("AppShell — DataModeBanner mounted in both branches", () => {
  it("mounts DataModeBanner in editorial branch", () => {
    pathnameRef.current = "/alex";
    render(
      <AppShell dataModeControlsAllowed={false}>
        <span>x</span>
      </AppShell>,
    );
    expect(screen.getByTestId("data-mode-banner")).toBeInTheDocument();
  });

  it("mounts DataModeBanner in bare-main branch", () => {
    pathnameRef.current = "/settings";
    render(
      <AppShell dataModeControlsAllowed={false}>
        <span>x</span>
      </AppShell>,
    );
    expect(screen.getByTestId("data-mode-banner")).toBeInTheDocument();
  });
});
