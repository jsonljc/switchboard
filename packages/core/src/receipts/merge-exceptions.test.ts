import { describe, it, expect } from "vitest";
import type { ExceptionCode } from "@switchboard/schemas";
import { mergeExceptions } from "./merge-exceptions.js";
import type { SerializedExceptionEntry } from "./build-receipted-booking-data.js";

const T = "2026-06-15T00:00:00.000Z";
const now = new Date(T);
const DUP: Set<ExceptionCode> = new Set(["duplicate_contact_risk"]);

describe("mergeExceptions", () => {
  it("new-raise: appends a fresh open entry for a governed code with no prior open", () => {
    const desired: SerializedExceptionEntry[] = [
      { code: "duplicate_contact_risk", detail: "same phone", raisedAt: T, resolvedAt: null },
    ];
    const out = mergeExceptions([], desired, now, DUP);
    expect(out).toEqual([
      { code: "duplicate_contact_risk", detail: "same phone", raisedAt: T, resolvedAt: null },
    ]);
  });

  it("keep-existing-open: a desired governed code with a prior OPEN entry is left untouched (raisedAt preserved)", () => {
    const prior: SerializedExceptionEntry[] = [
      {
        code: "duplicate_contact_risk",
        detail: "first",
        raisedAt: "2026-06-01T00:00:00.000Z",
        resolvedAt: null,
      },
    ];
    const desired: SerializedExceptionEntry[] = [
      { code: "duplicate_contact_risk", detail: "second", raisedAt: T, resolvedAt: null },
    ];
    const out = mergeExceptions(prior, desired, now, DUP);
    expect(out).toEqual([
      {
        code: "duplicate_contact_risk",
        detail: "first",
        raisedAt: "2026-06-01T00:00:00.000Z",
        resolvedAt: null,
      },
    ]);
  });

  it("resolve: a prior OPEN governed code NOT in desired gets resolvedAt stamped", () => {
    const prior: SerializedExceptionEntry[] = [
      { code: "duplicate_contact_risk", raisedAt: "2026-06-01T00:00:00.000Z", resolvedAt: null },
    ];
    const out = mergeExceptions(prior, [], now, DUP);
    expect(out).toEqual([
      { code: "duplicate_contact_risk", raisedAt: "2026-06-01T00:00:00.000Z", resolvedAt: T },
    ]);
  });

  it("re-raise: a prior RESOLVED governed code + now desired appends a NEW open entry, keeping the resolved history", () => {
    const prior: SerializedExceptionEntry[] = [
      {
        code: "duplicate_contact_risk",
        raisedAt: "2026-06-01T00:00:00.000Z",
        resolvedAt: "2026-06-05T00:00:00.000Z",
      },
    ];
    const desired: SerializedExceptionEntry[] = [
      { code: "duplicate_contact_risk", raisedAt: T, resolvedAt: null },
    ];
    const out = mergeExceptions(prior, desired, now, DUP);
    expect(out).toEqual([
      {
        code: "duplicate_contact_risk",
        raisedAt: "2026-06-01T00:00:00.000Z",
        resolvedAt: "2026-06-05T00:00:00.000Z",
      },
      { code: "duplicate_contact_risk", raisedAt: T, resolvedAt: null },
    ]);
  });

  it("non-governed passthrough: an open missing_consent is untouched when governedCodes={duplicate_contact_risk}", () => {
    const prior: SerializedExceptionEntry[] = [
      { code: "missing_consent", raisedAt: "2026-06-01T00:00:00.000Z", resolvedAt: null },
    ];
    const desired: SerializedExceptionEntry[] = [
      { code: "duplicate_contact_risk", raisedAt: T, resolvedAt: null },
    ];
    const out = mergeExceptions(prior, desired, now, DUP);
    expect(out).toEqual([
      { code: "missing_consent", raisedAt: "2026-06-01T00:00:00.000Z", resolvedAt: null },
      { code: "duplicate_contact_risk", raisedAt: T, resolvedAt: null },
    ]);
  });

  it("all prior RESOLVED entries pass through verbatim", () => {
    const prior: SerializedExceptionEntry[] = [
      {
        code: "missing_source",
        raisedAt: "2026-06-01T00:00:00.000Z",
        resolvedAt: "2026-06-02T00:00:00.000Z",
      },
    ];
    const out = mergeExceptions(prior, [], now, DUP);
    expect(out).toEqual([
      {
        code: "missing_source",
        raisedAt: "2026-06-01T00:00:00.000Z",
        resolvedAt: "2026-06-02T00:00:00.000Z",
      },
    ]);
  });

  it("detail is preserved on append (taken from the desired entry)", () => {
    const desired: SerializedExceptionEntry[] = [
      {
        code: "duplicate_contact_risk",
        detail: "matched +6591234567",
        raisedAt: T,
        resolvedAt: null,
      },
    ];
    const out = mergeExceptions([], desired, now, DUP);
    expect(out[0]!.detail).toBe("matched +6591234567");
  });

  it("emits JSON-native dates only (ISO strings, never Date)", () => {
    const prior: SerializedExceptionEntry[] = [
      { code: "duplicate_contact_risk", raisedAt: "2026-06-01T00:00:00.000Z", resolvedAt: null },
    ];
    const out = mergeExceptions(prior, [], now, DUP);
    for (const e of out) {
      expect(typeof e.raisedAt).toBe("string");
      expect(e.resolvedAt === null || typeof e.resolvedAt === "string").toBe(true);
    }
  });
});
