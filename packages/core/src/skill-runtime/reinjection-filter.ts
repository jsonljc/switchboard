import type { ToolResult } from "./tool-result.js";
import type { SkillToolOperation } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResultClass = "scalar" | "structured" | "tabular" | "diagnostic" | "reference";

export interface ReinjectionPolicy {
  maxToolResultChars: number;
  maxRetrievalResults: number;
}

export const DEFAULT_REINJECTION_POLICY: ReinjectionPolicy = {
  maxToolResultChars: 2000,
  maxRetrievalResults: 5,
};

export interface ReinjectionMeta {
  resultClass: ResultClass;
  originalSizeChars: number;
  injectedSizeChars: number;
  wasTruncated: boolean;
  wasCompacted: boolean;
  wasOmitted: boolean;
  traceId?: string;
}

export type ReinjectionDecision =
  | { kind: "pass"; content: string; meta: ReinjectionMeta }
  | { kind: "compact"; content: string; meta: ReinjectionMeta }
  | { kind: "truncate"; content: string; meta: ReinjectionMeta }
  | { kind: "omit"; content: string; meta: ReinjectionMeta };

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function classifyResult(result: ToolResult, operation: SkillToolOperation): ResultClass {
  if (operation.resultClass) return operation.resultClass;

  const data = result.data;
  if (!data || Object.keys(data).length === 0) return "scalar";

  for (const value of Object.values(data)) {
    if (Array.isArray(value) && value.length > 1) return "tabular";
  }

  return "structured";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(
  resultClass: ResultClass,
  originalSize: number,
  injectedSize: number,
  opts: { truncated?: boolean; compacted?: boolean; omitted?: boolean; traceId?: string },
): ReinjectionMeta {
  return {
    resultClass,
    originalSizeChars: originalSize,
    injectedSizeChars: injectedSize,
    wasTruncated: opts.truncated ?? false,
    wasCompacted: opts.compacted ?? false,
    wasOmitted: opts.omitted ?? false,
    traceId: opts.traceId,
  };
}

function compactArrays(
  data: Record<string, unknown>,
  maxItems: number,
): { compacted: Record<string, unknown>; didCompact: boolean } {
  let didCompact = false;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length > maxItems) {
      didCompact = true;
      out[key] = (value as unknown[]).slice(0, maxItems);
    } else {
      out[key] = value;
    }
  }

  if (didCompact) {
    const totalAvailable = Object.values(data).reduce((sum, v) => {
      return sum + (Array.isArray(v) ? v.length : 0);
    }, 0);
    out["_compaction"] = {
      truncated: true,
      totalAvailable,
      narrowingHint: "Too many results. Narrow by adding filters.",
    };
  }

  return { compacted: out, didCompact };
}

/** Frozen set of fields preserved during summarizeForModel truncation. */
const PRESERVED_FIELDS = ["status", "error", "entityState", "nextActions"] as const;

function buildSummarizedPayload(result: ToolResult, maxChars: number): string {
  const shell: Record<string, unknown> = {};
  for (const field of PRESERVED_FIELDS) {
    const value = result[field as keyof ToolResult];
    if (value !== undefined) {
      shell[field] = value;
    }
  }

  const shellJson = JSON.stringify(shell);
  if (shellJson.length <= maxChars) {
    // Try to fit as much data as possible
    const budget = maxChars - shellJson.length - 20; // headroom for merged keys
    if (budget > 10 && result.data) {
      const dataJson = JSON.stringify(result.data);
      const truncatedData = dataJson.slice(0, budget);
      shell["data"] = `${truncatedData}[...truncated]`;
    }
    return JSON.stringify(shell);
  }

  return shellJson.slice(0, maxChars);
}

// ---------------------------------------------------------------------------
// Main filter
// ---------------------------------------------------------------------------

export function filterForReinjection(
  result: ToolResult,
  operation: SkillToolOperation,
  policy: ReinjectionPolicy,
  traceId?: string,
): ReinjectionDecision {
  try {
    const resultClass = classifyResult(result, operation);

    // 1. Scalar always passes
    if (resultClass === "scalar") {
      const content = JSON.stringify(result);
      return {
        kind: "pass",
        content,
        meta: makeMeta(resultClass, content.length, content.length, { traceId }),
      };
    }

    // 2. Compaction for tabular / retrieval
    let workingResult = result;
    let didCompact = false;

    if ((resultClass === "tabular" || operation.retrieval) && result.data) {
      const { compacted, didCompact: compacted_ } = compactArrays(
        result.data,
        policy.maxRetrievalResults,
      );
      didCompact = compacted_;
      if (didCompact) {
        workingResult = { ...result, data: compacted };
      }
    }

    // 3. Serialize and check size
    const serialized = JSON.stringify(workingResult);
    const originalSize = JSON.stringify(result).length;

    // 4. Within budget
    if (serialized.length <= policy.maxToolResultChars) {
      return {
        kind: didCompact ? "compact" : "pass",
        content: serialized,
        meta: makeMeta(resultClass, originalSize, serialized.length, {
          compacted: didCompact,
          traceId,
        }),
      };
    }

    // 5. Omit if > 4x cap
    if (serialized.length > policy.maxToolResultChars * 4) {
      const stub = traceId
        ? `[tool result omitted due to size (${originalSize} chars); full result available in trace ${traceId}]`
        : `[tool result omitted due to size (${originalSize} chars)]`;
      return {
        kind: "omit",
        content: stub,
        meta: makeMeta(resultClass, originalSize, stub.length, { omitted: true, traceId }),
      };
    }

    // 6. Summarize if requested
    if (operation.summarizeForModel) {
      const summarized = buildSummarizedPayload(workingResult, policy.maxToolResultChars);
      return {
        kind: "truncate",
        content: summarized,
        meta: makeMeta(resultClass, originalSize, summarized.length, {
          truncated: true,
          compacted: didCompact,
          traceId,
        }),
      };
    }

    // 7. Plain truncation
    const suffix = traceId
      ? `[...truncated; full result available in trace ${traceId}]`
      : `[...truncated]`;
    const budget = policy.maxToolResultChars - suffix.length;
    const truncated = serialized.slice(0, Math.max(0, budget)) + suffix;

    return {
      kind: "truncate",
      content: truncated,
      meta: makeMeta(resultClass, originalSize, truncated.length, {
        truncated: true,
        compacted: didCompact,
        traceId,
      }),
    };
  } catch (_err: unknown) {
    const stub = traceId
      ? `[tool result omitted due to reinjection filter error; full result available in trace ${traceId}]`
      : `[tool result omitted due to reinjection filter error]`;
    const originalSize = (() => {
      try {
        return JSON.stringify(result).length;
      } catch {
        return 0;
      }
    })();
    return {
      kind: "omit",
      content: stub,
      meta: makeMeta("scalar", originalSize, stub.length, { omitted: true, traceId }),
    };
  }
}
