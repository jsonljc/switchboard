import { describe, it, expect, vi } from "vitest";
import { BuilderRegistry } from "../builder-registry.js";

describe("BuilderRegistry", () => {
  it("returns undefined for unregistered slug", () => {
    const registry = new BuilderRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("returns the registered builder for a known slug", () => {
    const registry = new BuilderRegistry();
    const builder = vi.fn();
    registry.register("sales-pipeline", builder);
    expect(registry.get("sales-pipeline")).toBe(builder);
  });

  it("throws when registering the same slug twice", () => {
    const registry = new BuilderRegistry();
    const builder = vi.fn();
    registry.register("sales-pipeline", builder);
    expect(() => registry.register("sales-pipeline", builder)).toThrow("already registered");
  });

  it("lists all registered slugs", () => {
    const registry = new BuilderRegistry();
    registry.register("a", vi.fn());
    registry.register("b", vi.fn());
    expect(registry.slugs()).toEqual(["a", "b"]);
  });
});
