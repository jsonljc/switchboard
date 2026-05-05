import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const notFoundFn = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

vi.mock("next/navigation", () => ({ notFound: notFoundFn }));

vi.mock("@/components/layout/editorial-auth-shell", () => ({
  EditorialAuthShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shell">{children}</div>
  ),
}));

import OwnerHomePage from "../page";

const ORIG_ENV = process.env.NEXT_PUBLIC_DEPLOY_ENV;

describe("Owner Home placeholder", () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = ORIG_ENV;
    notFoundFn.mockClear();
  });

  it("renders inside the EditorialAuthShell", async () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    render(await OwnerHomePage());
    expect(screen.getByTestId("shell")).toBeInTheDocument();
  });

  it("renders placeholder copy", async () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    render(await OwnerHomePage());
    expect(screen.getByText(/owner home/i)).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("notFound() in production env", async () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "production";
    await expect(OwnerHomePage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
