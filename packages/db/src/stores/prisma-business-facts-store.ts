import type { PrismaClient } from "@prisma/client";
import { BusinessFactsSchema, type BusinessFacts } from "@switchboard/schemas";

export type BusinessFactsStatus = "present" | "missing" | "malformed";

/**
 * Discriminated on `status` so `issues` is present exactly when `malformed` —
 * a consumer that branches on `status` reads `result.issues` without optional
 * chaining.
 */
export type BusinessFactsResult =
  | { status: "present"; facts: BusinessFacts; issues?: never }
  | { status: "missing"; facts: null; issues?: never }
  | { status: "malformed"; facts: null; issues: Array<{ path: string; code: string }> };

/**
 * Pure classifier shared by the store and the readiness gate so both decide
 * present | missing | malformed identically. No DB access.
 * Note: arrays and other non-plain-object JSON fall through to safeParse and
 * are reported as `malformed` (a better diagnostic than `missing`).
 */
export function classifyBusinessFacts(config: unknown): BusinessFactsResult {
  const isEmptyObject =
    typeof config === "object" &&
    config !== null &&
    !Array.isArray(config) &&
    Object.keys(config as Record<string, unknown>).length === 0;

  if (config == null || isEmptyObject) {
    return { facts: null, status: "missing" };
  }

  const parsed = BusinessFactsSchema.safeParse(config);
  if (!parsed.success) {
    return {
      facts: null,
      status: "malformed",
      // path.join(".") intentionally stringifies array indices (e.g. "services.2.name")
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
    };
  }
  return { facts: parsed.data, status: "present" };
}

export class PrismaBusinessFactsStore {
  constructor(private prisma: PrismaClient) {}

  /** Fetch + classify without side effects (used by the API route + readiness). */
  async getWithStatus(organizationId: string): Promise<BusinessFactsResult> {
    const row = await this.prisma.businessConfig.findUnique({ where: { organizationId } });
    return classifyBusinessFacts(row?.config ?? null);
  }

  /**
   * Runtime read for the live Alex path. A malformed row degrades to null
   * (Alex escalates politely) instead of throwing mid-turn. Warns WITHOUT
   * dumping the raw config (it holds phones / addresses / escalation contacts).
   */
  async get(organizationId: string): Promise<BusinessFacts | null> {
    const result = await this.getWithStatus(organizationId);
    if (result.status === "malformed") {
      console.warn("[BusinessFacts] malformed BusinessConfig.config", {
        organizationId,
        issues: result.issues,
      });
    }
    return result.facts;
  }

  async upsert(organizationId: string, facts: BusinessFacts): Promise<void> {
    await this.prisma.businessConfig.upsert({
      where: { organizationId },
      create: { organizationId, config: facts as object },
      update: { config: facts as object },
    });
  }
}
