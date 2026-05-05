import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const searchParamsRef = { current: new URLSearchParams() };

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

import { TweaksPanelMount } from "../tweaks-panel-mount";

const ORIG_ENV = process.env.NEXT_PUBLIC_DEPLOY_ENV;

describe("TweaksPanelMount", () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = ORIG_ENV;
    searchParamsRef.current = new URLSearchParams();
  });

  it("mounts the panel when ?tweaks=1 in non-prod", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    searchParamsRef.current = new URLSearchParams("tweaks=1");
    render(<TweaksPanelMount />);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("does not mount the panel without ?tweaks=1", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    searchParamsRef.current = new URLSearchParams();
    render(<TweaksPanelMount />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("does not mount the panel in production even with ?tweaks=1", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "production";
    searchParamsRef.current = new URLSearchParams("tweaks=1");
    render(<TweaksPanelMount />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
