import { describe, expect, it } from "vitest";
import { STEPS } from "../local-setup.js";

describe("local:setup STEPS", () => {
  it("runs install → setup-env → build → migrate → seed → verify:fast in order", () => {
    expect(STEPS.map((s) => s.name)).toEqual([
      "install",
      "setup-env",
      "build",
      "db:migrate",
      "db:seed",
      "local:verify:fast",
    ]);
  });

  it("invokes each step with the expected command contract", () => {
    // setup-env shells out to bash directly (bash is not a pnpm-managed binary,
    // so `pnpm exec bash` would not resolve). All other steps go through pnpm.
    expect(STEPS.find((s) => s.name === "install")).toMatchObject({
      cmd: "pnpm",
      args: ["install"],
    });
    expect(STEPS.find((s) => s.name === "setup-env")).toMatchObject({
      cmd: "bash",
      args: ["scripts/setup-env.sh"],
    });
    expect(STEPS.find((s) => s.name === "build")).toMatchObject({
      cmd: "pnpm",
      args: ["build"],
    });
    expect(STEPS.find((s) => s.name === "db:migrate")).toMatchObject({
      cmd: "pnpm",
      args: ["db:migrate"],
    });
    expect(STEPS.find((s) => s.name === "db:seed")).toMatchObject({
      cmd: "pnpm",
      args: ["db:seed"],
    });
    expect(STEPS.find((s) => s.name === "local:verify:fast")).toMatchObject({
      cmd: "pnpm",
      args: ["local:verify:fast"],
    });
  });

  it("gates DB-dependent steps via dbRequired flag", () => {
    expect(STEPS.find((s) => s.name === "db:migrate")?.dbRequired).toBe(true);
    expect(STEPS.find((s) => s.name === "db:seed")?.dbRequired).toBe(true);
    expect(STEPS.find((s) => s.name === "install")?.dbRequired).toBeFalsy();
    expect(STEPS.find((s) => s.name === "build")?.dbRequired).toBeFalsy();
    expect(STEPS.find((s) => s.name === "local:verify:fast")?.dbRequired).toBeFalsy();
    // Sentinel: local:verify:fast is skipped by NAME (not dbRequired) when no DB.
    // If this step name ever changes, main()'s skip logic at local-setup.ts must be updated to match.
    expect(STEPS.find((s) => s.name === "local:verify:fast")).toBeTruthy();
  });
});
