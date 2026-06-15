import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

// Radix Select does not drive cleanly in jsdom (no pointer-capture stubs here),
// so shim the UI primitive to native buttons. Only the presentation primitive
// is mocked; the component's connect-wiring logic stays real.
vi.mock("@/components/ui/select", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const OnChange = React.createContext<(v: string) => void>(() => {});
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (v: string) => void;
      children: ReactNode;
    }) =>
      React.createElement(
        OnChange.Provider,
        { value: onValueChange ?? (() => {}) },
        React.createElement("div", { "data-value": value ?? "" }, children),
      ),
    SelectTrigger: ({ children }: { children: ReactNode }) =>
      React.createElement("div", null, children),
    SelectValue: ({ placeholder }: { placeholder?: string }) =>
      React.createElement("span", null, placeholder ?? null),
    SelectContent: ({ children }: { children: ReactNode }) =>
      React.createElement("div", null, children),
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
      const onValueChange = React.useContext(OnChange);
      return React.createElement(
        "button",
        { type: "button", role: "option", onClick: () => onValueChange(value) },
        children,
      );
    },
  };
});

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

const useOrgDeploymentId = vi.fn();
vi.mock("@/hooks/use-deployments", () => ({
  useOrgDeploymentId: () => useOrgDeploymentId(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { ConnectionsList } from "../connections-list";

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(createElement(QueryClientProvider, { client: qc }, node));
}

function openMetaAdsConnectForm() {
  fireEvent.click(screen.getByRole("button", { name: /new connection/i }));
  fireEvent.click(screen.getByRole("option", { name: /meta ads/i }));
}

describe("ConnectionsList - Meta OAuth connect wiring", () => {
  let realLocation: Location;
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ connections: [] }) });
    realLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { href: "" },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: realLocation,
    });
  });

  it("sends the resolved deploymentId to the Meta authorize URL", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: "dep_1", isLoading: false, isError: false });
    wrap(<ConnectionsList />);
    openMetaAdsConnectForm();
    fireEvent.click(screen.getByRole("button", { name: /connect with meta/i }));
    expect(window.location.href).toBe(
      "/api/dashboard/connections/facebook/authorize?deploymentId=dep_1",
    );
  });

  it("disables the connect button + explains when the org has no deployment (so authorize never 400s)", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: null, isLoading: false, isError: false });
    wrap(<ConnectionsList />);
    openMetaAdsConnectForm();
    expect(screen.getByRole("button", { name: /connect with meta/i })).toBeDisabled();
    expect(screen.getByText(/deploy an agent/i)).toBeInTheDocument();
  });
});
