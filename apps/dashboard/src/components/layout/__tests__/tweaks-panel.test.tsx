import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TweaksPanel } from "../tweaks-panel";

const ORIG_ENV = process.env.NEXT_PUBLIC_DEPLOY_ENV;

describe("TweaksPanel", () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = ORIG_ENV;
  });

  it("does not render in production even with ?tweaks=1", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "production";
    render(<TweaksPanel hasTweaksFlag={true} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("does not render without ?tweaks=1 in non-prod", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    render(<TweaksPanel hasTweaksFlag={false} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("renders in non-prod with ?tweaks=1", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    render(<TweaksPanel hasTweaksFlag={true} />);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });
});
