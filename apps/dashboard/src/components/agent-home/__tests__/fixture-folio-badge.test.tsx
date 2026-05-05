import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FixtureFolioBadge } from "../fixture-folio-badge";

const ORIGINAL = process.env.NEXT_PUBLIC_DEPLOY_ENV;

describe("FixtureFolioBadge", () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = ORIGINAL;
  });

  it("renders · FIXTURE when dataSource is fixture (non-prod)", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    render(<FixtureFolioBadge dataSource="fixture" />);
    expect(screen.getByText("· FIXTURE")).toBeInTheDocument();
  });

  it("renders nothing when dataSource is live", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "preview";
    const { container } = render(<FixtureFolioBadge dataSource="live" />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing in production even when dataSource is fixture", () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = "production";
    const { container } = render(<FixtureFolioBadge dataSource="fixture" />);
    expect(container.textContent).toBe("");
  });
});
