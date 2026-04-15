import { describe, it, expect, vi } from "vitest";
import {
  ParameterResolutionError,
  validateBuilderRegistration,
  type ParameterBuilder,
} from "./parameter-builder.js";

describe("ParameterResolutionError", () => {
  it("has code and userMessage", () => {
    const err = new ParameterResolutionError("no-opportunity", "No active deal found.");
    expect(err.code).toBe("no-opportunity");
    expect(err.userMessage).toBe("No active deal found.");
    expect(err.name).toBe("ParameterResolutionError");
    expect(err.message).toBe("No active deal found.");
  });
});

describe("validateBuilderRegistration", () => {
  it("passes when all skill slugs have builders", () => {
    const deployments = [{ skillSlug: "sales-pipeline" }, { skillSlug: "website-profiler" }];
    const builders = new Map<string, ParameterBuilder>([
      ["sales-pipeline", vi.fn()],
      ["website-profiler", vi.fn()],
    ]);
    expect(() => validateBuilderRegistration(deployments, builders)).not.toThrow();
  });

  it("throws when a deployment references a skill without a builder", () => {
    const deployments = [{ skillSlug: "unknown-skill" }];
    const builders = new Map<string, ParameterBuilder>();
    expect(() => validateBuilderRegistration(deployments, builders)).toThrow(
      'Deployment references skill "unknown-skill" but no ParameterBuilder is registered',
    );
  });

  it("ignores deployments with null skillSlug", () => {
    const deployments = [{ skillSlug: null }, { skillSlug: "sales-pipeline" }];
    const builders = new Map<string, ParameterBuilder>([["sales-pipeline", vi.fn()]]);
    expect(() => validateBuilderRegistration(deployments, builders)).not.toThrow();
  });
});
