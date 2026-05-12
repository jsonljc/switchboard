import { describe, expect, it, vi } from "vitest";
import { LifecycleConfigResolver } from "../lifecycle-config-resolver.js";

describe("LifecycleConfigResolver — qualification capability", () => {
  function makeResolver(config: unknown) {
    return new LifecycleConfigResolver({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      governanceConfigResolver: { resolve: vi.fn().mockResolvedValue(config) } as any,
    });
  }

  it("returns empty set when both flags are off", async () => {
    const resolver = makeResolver({ lifecycleTagging: {} });
    expect(await resolver.resolveCapabilities("o")).toEqual(new Set());
  });

  it("returns {mechanical} when only mechanical is on", async () => {
    const resolver = makeResolver({ lifecycleTagging: { mechanical: { mode: "on" } } });
    expect(await resolver.resolveCapabilities("o")).toEqual(new Set(["mechanical"]));
  });

  it("returns {mechanical, qualification} when both are on", async () => {
    const resolver = makeResolver({
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
    });
    expect(await resolver.resolveCapabilities("o")).toEqual(
      new Set(["mechanical", "qualification"]),
    );
  });

  it("auto-enables mechanical when qualification is on but mechanical is off (logs warn)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const resolver = makeResolver({ lifecycleTagging: { qualification: { mode: "on" } } });
    const caps = await resolver.resolveCapabilities("o");
    expect(caps).toEqual(new Set(["mechanical", "qualification"]));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
