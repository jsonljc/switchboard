import { describe, it, expect } from "vitest";
import { InMemoryCartridgeRegistry } from "../storage/in-memory.js";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";

describe("compareSemver with pre-release (#19)", () => {
  it("should treat pre-release as less than release", () => {
    const registry = new InMemoryCartridgeRegistry();

    // Register v1.0.0-beta
    const betaCartridge = new TestCartridge(createTestManifest({ version: "1.0.0-beta" }));
    registry.register("test", betaCartridge);

    // Upgrading to v1.0.0 (release) should succeed
    const releaseCartridge = new TestCartridge(createTestManifest({ version: "1.0.0" }));
    expect(() => registry.register("test", releaseCartridge)).not.toThrow();
  });

  it("should reject downgrade from release to pre-release", () => {
    const registry = new InMemoryCartridgeRegistry();

    // Register v1.0.0
    const release = new TestCartridge(createTestManifest({ version: "1.0.0" }));
    registry.register("test", release);

    // Trying to register v1.0.0-beta should fail (downgrade)
    const beta = new TestCartridge(createTestManifest({ version: "1.0.0-beta" }));
    expect(() => registry.register("test", beta)).toThrow("would downgrade");
  });

  it("should handle NaN in version segments gracefully", () => {
    const registry = new InMemoryCartridgeRegistry();

    // Register a valid version
    const v1 = new TestCartridge(createTestManifest({ version: "1.0.0" }));
    registry.register("test", v1);

    // Register a higher version — should succeed
    const v2 = new TestCartridge(createTestManifest({ version: "2.0.0" }));
    expect(() => registry.register("test", v2)).not.toThrow();
  });

  it("should invoke onChange callback on register and unregister", () => {
    let changeCount = 0;
    const registry = new InMemoryCartridgeRegistry({ onChange: () => { changeCount++; } });

    const cart = new TestCartridge(createTestManifest({ version: "1.0.0" }));
    registry.register("test", cart);
    expect(changeCount).toBe(1);

    registry.unregister("test");
    expect(changeCount).toBe(2);
  });
});
