import { describe, it, expect } from "vitest";
import type { ExceptionEntry } from "@switchboard/schemas";
import type { SerializedExceptionEntry } from "../build-receipted-booking-data.js";
import { assembleViewExceptions } from "../assemble-view-exceptions.js";

const now = new Date("2026-06-15T00:00:00Z");
const isoNow = now.toISOString();
const isoEarlier = "2026-06-10T00:00:00Z";

describe("assembleViewExceptions", () => {
  it("returns recomputable unchanged when persisted is empty", () => {
    const recomputable: ExceptionEntry[] = [{ code: "missing_source", raisedAt: now }];
    const result = assembleViewExceptions(recomputable, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.code).toBe("missing_source");
  });

  it("carries an OPEN persisted duplicate_contact_risk entry (code not in recomputable) with raisedAt as a Date", () => {
    const recomputable: ExceptionEntry[] = [{ code: "missing_source", raisedAt: now }];
    const persisted: SerializedExceptionEntry[] = [
      { code: "duplicate_contact_risk", raisedAt: isoEarlier, resolvedAt: null },
    ];
    const result = assembleViewExceptions(recomputable, persisted);
    expect(result).toHaveLength(2);
    const dup = result.find((e) => e.code === "duplicate_contact_risk");
    expect(dup).toBeDefined();
    expect(dup!.raisedAt).toBeInstanceOf(Date);
    expect(dup!.raisedAt).toEqual(new Date(isoEarlier));
    expect(dup!.resolvedAt).toBeNull();
  });

  it("drops a RESOLVED persisted entry (resolvedAt set)", () => {
    const recomputable: ExceptionEntry[] = [];
    const persisted: SerializedExceptionEntry[] = [
      { code: "duplicate_contact_risk", raisedAt: isoEarlier, resolvedAt: isoNow },
    ];
    const result = assembleViewExceptions(recomputable, persisted);
    expect(result).toHaveLength(0);
  });

  it("drops a persisted entry whose code IS in recomputable (recomputable wins, no double)", () => {
    const recomputable: ExceptionEntry[] = [{ code: "missing_source", raisedAt: now }];
    const persisted: SerializedExceptionEntry[] = [
      // Same code as in recomputable - must be dropped to avoid duplicate
      { code: "missing_source", raisedAt: isoEarlier, resolvedAt: null },
    ];
    const result = assembleViewExceptions(recomputable, persisted);
    expect(result).toHaveLength(1);
    expect(result[0]!.code).toBe("missing_source");
    // The one entry should be the recomputed one (raisedAt = now), not the persisted one
    expect(result[0]!.raisedAt).toEqual(now);
  });

  it("preserves detail when present on a carried entry", () => {
    const recomputable: ExceptionEntry[] = [];
    const persisted: SerializedExceptionEntry[] = [
      {
        code: "duplicate_contact_risk",
        detail: "same phone as ct-2",
        raisedAt: isoEarlier,
        resolvedAt: null,
      },
    ];
    const result = assembleViewExceptions(recomputable, persisted);
    expect(result).toHaveLength(1);
    expect(result[0]!.detail).toBe("same phone as ct-2");
  });

  it("returns empty array when both inputs are empty", () => {
    const result = assembleViewExceptions([], []);
    expect(result).toHaveLength(0);
  });

  it("does not include detail key when detail is undefined in persisted entry", () => {
    const recomputable: ExceptionEntry[] = [];
    const persisted: SerializedExceptionEntry[] = [
      { code: "duplicate_contact_risk", raisedAt: isoEarlier, resolvedAt: null },
    ];
    const result = assembleViewExceptions(recomputable, persisted);
    expect(result).toHaveLength(1);
    expect("detail" in result[0]!).toBe(false);
  });

  it("suppresses a persisted code listed in suppressPersistedCodes (stale missing_consent drop)", () => {
    // missing_consent is not recomputable here (the live recompute omits it when consent is
    // not_applicable), so without suppression it would carry forward stale. The set drops it.
    const recomputable: ExceptionEntry[] = [];
    const persisted: SerializedExceptionEntry[] = [
      { code: "missing_consent", raisedAt: isoEarlier, resolvedAt: null },
    ];
    const result = assembleViewExceptions(recomputable, persisted, new Set(["missing_consent"]));
    expect(result).toHaveLength(0);
  });

  it("carries a persisted missing_consent when it is NOT in the suppression set (legit signal kept)", () => {
    const recomputable: ExceptionEntry[] = [];
    const persisted: SerializedExceptionEntry[] = [
      { code: "missing_consent", raisedAt: isoEarlier, resolvedAt: null },
    ];
    // Empty suppression set (the non-null-jurisdiction caller) -> the persisted entry survives.
    const result = assembleViewExceptions(recomputable, persisted, new Set());
    expect(result).toHaveLength(1);
    expect(result[0]!.code).toBe("missing_consent");
  });

  it("suppression does not touch a different persisted code", () => {
    const recomputable: ExceptionEntry[] = [];
    const persisted: SerializedExceptionEntry[] = [
      { code: "missing_consent", raisedAt: isoEarlier, resolvedAt: null },
      { code: "duplicate_contact_risk", raisedAt: isoEarlier, resolvedAt: null },
    ];
    const result = assembleViewExceptions(recomputable, persisted, new Set(["missing_consent"]));
    expect(result.map((e) => e.code)).toEqual(["duplicate_contact_risk"]);
  });
});
