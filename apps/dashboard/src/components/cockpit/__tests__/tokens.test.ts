import { describe, it, expect } from "vitest";
import { T } from "../tokens";

describe("cockpit tokens", () => {
  it("exports the canonical color palette from the locked design", () => {
    expect(T.bg).toBe("#FAF8F2");
    expect(T.paper).toBe("#FFFFFF");
    expect(T.ink).toBe("#0E0C0A");
    expect(T.amber).toBe("#B8782E");
    expect(T.amberDeep).toBe("#7C4F1C");
    expect(T.green).toBe("#3F7A36");
    expect(T.red).toBe("#A03A2E");
    expect(T.blue).toBe("#3A5A80");
  });
});
