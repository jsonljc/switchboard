import { describe, it, expect } from "vitest";
import {
  filterForReinjection,
  DEFAULT_REINJECTION_POLICY,
  type ReinjectionPolicy,
} from "../reinjection-filter.js";
import type { SkillToolOperation } from "../types.js";
import { ok } from "../tool-result.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubOp(overrides: Partial<SkillToolOperation> = {}): SkillToolOperation {
  return {
    description: "test op",
    inputSchema: {},
    effectCategory: "read",
    execute: async () => ok(),
    ...overrides,
  };
}

const TINY_POLICY: ReinjectionPolicy = { maxToolResultChars: 50, maxRetrievalResults: 3 };

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe("classification", () => {
  it("no data → scalar", () => {
    const decision = filterForReinjection(ok(), stubOp(), DEFAULT_REINJECTION_POLICY);
    expect(decision.meta.resultClass).toBe("scalar");
  });

  it("empty data {} → scalar", () => {
    const decision = filterForReinjection(ok({}), stubOp(), DEFAULT_REINJECTION_POLICY);
    expect(decision.meta.resultClass).toBe("scalar");
  });

  it("data with array values (>1 element) → tabular", () => {
    const decision = filterForReinjection(
      ok({ rows: [1, 2, 3] }),
      stubOp(),
      DEFAULT_REINJECTION_POLICY,
    );
    expect(decision.meta.resultClass).toBe("tabular");
  });

  it("data with non-array values → structured", () => {
    const decision = filterForReinjection(
      ok({ name: "foo", count: 42 }),
      stubOp(),
      DEFAULT_REINJECTION_POLICY,
    );
    expect(decision.meta.resultClass).toBe("structured");
  });

  it("explicit resultClass overrides inference", () => {
    const decision = filterForReinjection(
      ok({ rows: [1, 2, 3] }),
      stubOp({ resultClass: "diagnostic" }),
      DEFAULT_REINJECTION_POLICY,
    );
    expect(decision.meta.resultClass).toBe("diagnostic");
  });
});

// ---------------------------------------------------------------------------
// Pass-through
// ---------------------------------------------------------------------------

describe("pass-through", () => {
  it("small structured result passes unchanged", () => {
    const result = ok({ name: "foo" });
    const decision = filterForReinjection(result, stubOp(), DEFAULT_REINJECTION_POLICY);
    expect(decision.kind).toBe("pass");
    expect(JSON.parse(decision.content)).toEqual(result);
    expect(decision.meta.wasTruncated).toBe(false);
    expect(decision.meta.wasCompacted).toBe(false);
    expect(decision.meta.wasOmitted).toBe(false);
  });

  it("scalar always passes regardless of tiny policy", () => {
    const result = ok();
    const decision = filterForReinjection(result, stubOp(), TINY_POLICY);
    expect(decision.kind).toBe("pass");
    expect(decision.meta.resultClass).toBe("scalar");
  });
});

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

describe("compaction", () => {
  it("tabular result with 10 items compacted to 3 when maxRetrievalResults=3", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const result = ok({ items });
    const policy: ReinjectionPolicy = { maxToolResultChars: 10_000, maxRetrievalResults: 3 };
    const decision = filterForReinjection(result, stubOp(), policy);

    expect(decision.kind).toBe("compact");
    expect(decision.meta.wasCompacted).toBe(true);

    const parsed = JSON.parse(decision.content);
    expect(parsed.data.items).toHaveLength(3);
    expect(parsed.data._compaction).toEqual({
      truncated: true,
      totalAvailable: 10,
      narrowingHint: "Too many results. Narrow by adding filters.",
    });
  });

  it("tabular under limit not compacted", () => {
    const result = ok({ items: [1, 2] });
    const policy: ReinjectionPolicy = { maxToolResultChars: 10_000, maxRetrievalResults: 5 };
    const decision = filterForReinjection(result, stubOp(), policy);

    expect(decision.kind).toBe("pass");
    expect(decision.meta.wasCompacted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

describe("truncation", () => {
  it("result exceeding cap gets truncated", () => {
    const bigData: Record<string, unknown> = { payload: "x".repeat(200) };
    const result = ok(bigData);
    const policy: ReinjectionPolicy = { maxToolResultChars: 100, maxRetrievalResults: 5 };
    const decision = filterForReinjection(result, stubOp(), policy, "trace-123");

    expect(decision.kind).toBe("truncate");
    expect(decision.content).toContain("[...truncated;");
    expect(decision.content).toContain("trace-123");
    expect(decision.meta.wasTruncated).toBe(true);
  });

  it("summarizeForModel preserves status, entityState, nextActions", () => {
    const result = ok({ bigField: "x".repeat(500) });
    result.entityState = { key: "value" };
    result.nextActions = ["follow_up"];

    const policy: ReinjectionPolicy = { maxToolResultChars: 300, maxRetrievalResults: 5 };
    const decision = filterForReinjection(
      result,
      stubOp({ summarizeForModel: true }),
      policy,
      "trace-456",
    );

    expect(decision.kind).toBe("truncate");
    const parsed = JSON.parse(decision.content);
    expect(parsed.status).toBe("success");
    expect(parsed.entityState).toEqual({ key: "value" });
    expect(parsed.nextActions).toEqual(["follow_up"]);
    expect(decision.meta.wasTruncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Omission
// ---------------------------------------------------------------------------

describe("omission", () => {
  it("result exceeding 4× cap gets omitted", () => {
    const bigData: Record<string, unknown> = { payload: "x".repeat(1000) };
    const result = ok(bigData);
    const policy: ReinjectionPolicy = { maxToolResultChars: 100, maxRetrievalResults: 5 };
    const decision = filterForReinjection(result, stubOp(), policy, "trace-789");

    expect(decision.kind).toBe("omit");
    expect(decision.content).toContain("tool result omitted due to size");
    expect(decision.meta.wasOmitted).toBe(true);
  });

  it("traceId appears in omission stub when provided", () => {
    const bigData: Record<string, unknown> = { payload: "x".repeat(1000) };
    const result = ok(bigData);
    const policy: ReinjectionPolicy = { maxToolResultChars: 100, maxRetrievalResults: 5 };
    const decision = filterForReinjection(result, stubOp(), policy, "my-trace");

    expect(decision.content).toContain("my-trace");
  });
});

// ---------------------------------------------------------------------------
// Failure fallback
// ---------------------------------------------------------------------------

describe("failure fallback", () => {
  it("when data getter throws, returns safe omission stub", () => {
    const result = ok();
    // Create a proxy that throws when accessing data
    const poisoned = new Proxy(result, {
      get(target, prop) {
        if (prop === "data") {
          return {
            get _boom() {
              throw new Error("kaboom");
            },
          };
        }
        return Reflect.get(target, prop);
      },
    });

    // Force classification to non-scalar so we enter compaction/serialization path
    const op = stubOp({ resultClass: "tabular", retrieval: true });

    // The proxy data has a getter that throws during JSON.stringify
    const decision = filterForReinjection(poisoned, op, DEFAULT_REINJECTION_POLICY, "trace-err");

    expect(decision.kind).toBe("omit");
    expect(decision.content).toContain("reinjection filter error");
    expect(decision.content).toContain("trace-err");
  });
});
