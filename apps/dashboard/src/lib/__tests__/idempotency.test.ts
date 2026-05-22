import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdempotencyKey } from "../idempotency";

describe("createIdempotencyKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a UUID when globalThis.crypto.randomUUID is defined", () => {
    const fakeUuid = "00000000-1111-2222-3333-444444444444";
    vi.stubGlobal("crypto", {
      randomUUID: () => fakeUuid,
    });

    expect(createIdempotencyKey()).toBe(fakeUuid);
  });

  it("falls back to idemp_* when globalThis.crypto is undefined", () => {
    vi.stubGlobal("crypto", undefined);

    const key = createIdempotencyKey();
    expect(key).toMatch(/^idemp_\d+_[a-z0-9]+$/);
  });

  it("falls back to idemp_* when randomUUID is missing on crypto", () => {
    // crypto exists but lacks randomUUID (e.g. older runtime, partial polyfill).
    vi.stubGlobal("crypto", {});

    const key = createIdempotencyKey();
    expect(key).toMatch(/^idemp_\d+_[a-z0-9]+$/);
  });

  it("always returns a non-empty string", () => {
    const key = createIdempotencyKey();
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });
});
