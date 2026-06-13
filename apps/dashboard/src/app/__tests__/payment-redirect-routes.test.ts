import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PAYMENT_SUCCESS_PATH, PAYMENT_CANCEL_PATH } from "@switchboard/schemas";

const APP = join(__dirname, "..");

describe("payment redirect routes (api -> dashboard seam)", () => {
  it("serves a public page at the canonical success path", () => {
    expect(existsSync(join(APP, "(public)", PAYMENT_SUCCESS_PATH, "page.tsx"))).toBe(true);
  });

  it("serves a public page at the canonical cancel path", () => {
    expect(existsSync(join(APP, "(public)", PAYMENT_CANCEL_PATH, "page.tsx"))).toBe(true);
  });
});
