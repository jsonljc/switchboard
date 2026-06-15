import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

import ConnectionsCallbackPage from "../(auth)/connections/callback/page";

function wrapWithClient(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const utils = render(createElement(QueryClientProvider, { client: qc }, node));
  return { ...utils, spy };
}

describe("ConnectionsCallbackPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search = "";
  });

  it("renders a Connected state naming the deployment when connected=true", () => {
    search = "connected=true&deploymentId=dep_1";
    wrapWithClient(<ConnectionsCallbackPage />);
    expect(screen.getByText(/meta is connected/i)).toBeInTheDocument();
    expect(screen.getByText(/dep_1/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /return to connections/i })).toHaveAttribute(
      "href",
      "/settings/channels",
    );
  });

  it("names Google Calendar when the callback carries service=google_calendar", () => {
    search = "connected=true&deploymentId=dep_1&service=google_calendar";
    wrapWithClient(<ConnectionsCallbackPage />);
    expect(screen.getByText(/google calendar is connected/i)).toBeInTheDocument();
    expect(screen.queryByText(/meta is connected/i)).toBeNull();
  });

  it("renders a neutral not-confirmed state when connected is absent", () => {
    search = "";
    wrapWithClient(<ConnectionsCallbackPage />);
    expect(screen.getByText(/could not confirm/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /return to connections/i })).toHaveAttribute(
      "href",
      "/settings/channels",
    );
  });

  it("invalidates the connections query on a successful callback (refreshes the badge on return)", () => {
    search = "connected=true&deploymentId=dep_1";
    const { spy } = wrapWithClient(<ConnectionsCallbackPage />);
    expect(spy).toHaveBeenCalled();
  });

  it("does not invalidate when the callback is not a success", () => {
    search = "connected=false";
    const { spy } = wrapWithClient(<ConnectionsCallbackPage />);
    expect(spy).not.toHaveBeenCalled();
  });
});
