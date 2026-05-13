import { describe, it, expect } from "vitest";
import { inferCartridgeId } from "../cartridge-utils.js";

describe("inferCartridgeId", () => {
  it("returns null when no registry provided", () => {
    expect(inferCartridgeId("ads.create")).toBeNull();
  });
});
