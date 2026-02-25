import { createHash } from "node:crypto";
import { canonicalizeSync } from "@switchboard/core";

export interface SessionStatus {
  callCount: number;
  mutationCount: number;
  totalDollarsAtRisk: number;
  maxCalls: number;
  maxMutations: number;
  maxDollars: number;
  escalationActive: boolean;
  duplicateWindowMs: number;
}

export type DollarExtractor = (toolName: string, args: Record<string, unknown>) => number;

/**
 * Default dollar extractor: looks for common dollar-amount fields.
 */
function defaultDollarExtractor(toolName: string, args: Record<string, unknown>): number {
  // Check for explicit dollar amount fields
  if (typeof args["newBudget"] === "number") return args["newBudget"];
  if (typeof args["dollarsAtRisk"] === "number") return args["dollarsAtRisk"];
  if (typeof args["amount"] === "number") return args["amount"];

  // For trading orders: quantity * price
  if (typeof args["quantity"] === "number" && typeof args["limitPrice"] === "number") {
    return args["quantity"] * args["limitPrice"];
  }

  // Fallback for market orders: quantity * currentPrice
  if (typeof args["quantity"] === "number" && typeof args["currentPrice"] === "number") {
    return args["quantity"] * args["currentPrice"];
  }

  return 0;
}

export class SessionGuard {
  private callCount = 0;
  private mutationCount = 0;
  private totalDollarsAtRisk = 0;
  private recentCalls: Array<{ hash: string; timestamp: number }> = [];

  private readonly maxCalls: number;
  private readonly maxMutations: number;
  private readonly maxDollars: number;
  private readonly duplicateWindowMs: number;
  private readonly escalationThreshold: number;
  private readonly dollarExtractor: DollarExtractor;

  constructor(options?: {
    maxCalls?: number;
    maxMutations?: number;
    maxDollars?: number;
    duplicateWindowMs?: number;
    escalationThreshold?: number;
    dollarExtractor?: DollarExtractor;
  }) {
    this.maxCalls = options?.maxCalls ?? 200;
    this.maxMutations = options?.maxMutations ?? 50;
    this.maxDollars = options?.maxDollars ?? 10_000;
    this.duplicateWindowMs = options?.duplicateWindowMs ?? 5_000;
    this.escalationThreshold = options?.escalationThreshold ?? 10;
    this.dollarExtractor = options?.dollarExtractor ?? defaultDollarExtractor;
  }

  checkCall(
    toolName: string,
    args: Record<string, unknown>,
    isMutation: boolean,
  ): { allowed: boolean; reason?: string } {
    // 1. Total call count
    if (this.callCount >= this.maxCalls) {
      return { allowed: false, reason: `Session call limit reached (${this.maxCalls})` };
    }

    // 2. Mutation count
    if (isMutation && this.mutationCount >= this.maxMutations) {
      return { allowed: false, reason: `Session mutation limit reached (${this.maxMutations})` };
    }

    // 3. Dollar exposure pre-check (generic extraction)
    if (isMutation) {
      const dollars = this.dollarExtractor(toolName, args);
      if (dollars > 0 && this.totalDollarsAtRisk + dollars > this.maxDollars) {
        return {
          allowed: false,
          reason: `Session dollar exposure limit would be exceeded ($${this.totalDollarsAtRisk + dollars} > $${this.maxDollars})`,
        };
      }
    }

    // 4. Duplicate detection
    const now = Date.now();
    this.pruneRecentCalls(now);
    const hash = this.computeCallHash(toolName, args);
    if (isMutation && this.recentCalls.some((c) => c.hash === hash)) {
      return { allowed: false, reason: "Duplicate mutation detected within dedup window" };
    }

    return { allowed: true };
  }

  recordCall(
    toolName: string,
    args: Record<string, unknown>,
    isMutation: boolean,
  ): void {
    this.callCount++;

    if (isMutation) {
      this.mutationCount++;

      const now = Date.now();
      const hash = this.computeCallHash(toolName, args);
      this.recentCalls.push({ hash, timestamp: now });

      // Track dollar exposure generically
      const dollars = this.dollarExtractor(toolName, args);
      if (dollars > 0) {
        this.totalDollarsAtRisk += dollars;
      }
    }
  }

  get escalationActive(): boolean {
    return this.mutationCount >= this.escalationThreshold;
  }

  getStatus(): SessionStatus {
    return {
      callCount: this.callCount,
      mutationCount: this.mutationCount,
      totalDollarsAtRisk: this.totalDollarsAtRisk,
      maxCalls: this.maxCalls,
      maxMutations: this.maxMutations,
      maxDollars: this.maxDollars,
      escalationActive: this.escalationActive,
      duplicateWindowMs: this.duplicateWindowMs,
    };
  }

  static fromEnv(): SessionGuard {
    return new SessionGuard({
      maxCalls: parseEnvInt("MCP_SESSION_MAX_CALLS", 200),
      maxMutations: parseEnvInt("MCP_SESSION_MAX_MUTATIONS", 50),
      maxDollars: parseEnvInt("MCP_SESSION_MAX_DOLLARS", 10_000),
      duplicateWindowMs: parseEnvInt("MCP_SESSION_DUPLICATE_WINDOW_MS", 5_000),
      escalationThreshold: parseEnvInt("MCP_SESSION_ESCALATION_THRESHOLD", 10),
    });
  }

  private computeCallHash(toolName: string, args: Record<string, unknown>): string {
    const canonicalArgs = canonicalizeSync(args);
    return createHash("sha256").update(`${toolName}:${canonicalArgs}`).digest("hex");
  }

  private pruneRecentCalls(now: number): void {
    this.recentCalls = this.recentCalls.filter(
      (c) => now - c.timestamp < this.duplicateWindowMs,
    );
  }
}

function parseEnvInt(name: string, defaultValue: number): number {
  const val = process.env[name];
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}
