import { describe, expect, it } from "vitest";
import type { HandoffReason } from "./types.js";

describe("HandoffReason", () => {
  it("includes outside_whatsapp_window", () => {
    const r: HandoffReason = "outside_whatsapp_window";
    expect(r).toBe("outside_whatsapp_window");
  });
});
