import type { PrismaClient } from "@prisma/client";
import {
  OperationalStateSchema,
  type OperationalState,
  type OperationalStateConfirmation,
} from "@switchboard/schemas";

/**
 * Append-only store for operator confirmations of business operational state
 * (Riley v3 slice 4a; spec sections 2.1 net-new paragraph and 7.4).
 *
 * Sibling of PrismaBusinessFactsStore, NOT an extension of it: BusinessConfig
 * holds durable identity facts written whole-blob by the operator editor, so
 * a freshness anchor stored there would move (or be erased) under unrelated
 * identity edits. Confirmations are INSERT-only; confirmedAt is written once
 * and never updated.
 *
 * Validity is derived, not stored: confirmation i is in force over
 * [confirmedAt_i, confirmedAt_of_next_row), open-ended for the latest row.
 * Same-instant ties are broken by createdAt then id: the later row
 * supersedes, the earlier row's derived interval is zero-length (acceptable),
 * and every read orders by the full (confirmedAt, createdAt, id) triple so
 * the rule is deterministic. getConfirmationsOverlappingWindow returns every
 * confirmation whose derived validity overlaps a (past) attribution window,
 * which is the substrate the slice-4c outcome path needs for
 * businessContextStable / businessContextFreshness. Staleness POLICY (how
 * old a confirmation may be and still vouch) is deliberately NOT encoded
 * here; that is 4c's call.
 *
 * This slice ships capability only: no app code constructs this store yet.
 * The 4b operator editor will call recordConfirmation through the existing
 * org-scoped settings write path (the marketplace business-facts route
 * conventions), never through PlatformIngress (a settings write, not a
 * revenue action).
 */

/** Row shape for OperationalStateConfirmation (matches schema.prisma). */
interface ConfirmationRow {
  id: string;
  organizationId: string;
  operatingStatus: string | null;
  staffing: string | null;
  inventory: string | null;
  promoWindows: unknown;
  closures: unknown;
  note: string | null;
  confirmedBy: string | null;
  confirmedAt: Date;
  createdAt: Date;
}

/**
 * Reassemble the typed state from columns, dropping NULLs (NULL = the
 * operator never confirmed that dimension). A row that fails validation
 * degrades to null with a warning: cron-adjacent read paths must never throw
 * and must never surface fabricated state.
 */
function rowToConfirmation(row: ConfirmationRow): OperationalStateConfirmation | null {
  const state: Record<string, unknown> = {};
  if (row.operatingStatus !== null) state.operatingStatus = row.operatingStatus;
  if (row.staffing !== null) state.staffing = row.staffing;
  if (row.inventory !== null) state.inventory = row.inventory;
  if (row.promoWindows !== null && row.promoWindows !== undefined) {
    state.promoWindows = row.promoWindows;
  }
  if (row.closures !== null && row.closures !== undefined) state.closures = row.closures;
  if (row.note !== null) state.note = row.note;

  const parsed = OperationalStateSchema.safeParse(state);
  if (!parsed.success) {
    console.warn("[OperationalState] malformed confirmation row skipped", {
      id: row.id,
      organizationId: row.organizationId,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
    });
    return null;
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    state: parsed.data,
    confirmedBy: row.confirmedBy,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
  };
}

export class PrismaOperationalStateStore {
  constructor(private prisma: PrismaClient) {}

  /**
   * Record an operator confirmation (INSERT-only; never updates prior rows).
   * Unconfirmed dimensions are omitted from the insert so their columns stay
   * NULL (= unconfirmed), never a fabricated "open"/"normal". confirmedAt is
   * REQUIRED: the caller supplies the operator confirmation moment
   * consciously; neither the store nor the database fabricates one. 4a ships
   * NO caller: only an explicit operator confirmation (the 4b editor) may
   * create rows.
   */
  async recordConfirmation(
    organizationId: string,
    state: OperationalState,
    opts: { confirmedAt: Date; confirmedBy?: string },
  ): Promise<OperationalStateConfirmation> {
    const parsed = OperationalStateSchema.parse(state);
    const row = await this.prisma.operationalStateConfirmation.create({
      data: {
        organizationId,
        ...(parsed.operatingStatus !== undefined
          ? { operatingStatus: parsed.operatingStatus }
          : {}),
        ...(parsed.staffing !== undefined ? { staffing: parsed.staffing } : {}),
        ...(parsed.inventory !== undefined ? { inventory: parsed.inventory } : {}),
        ...(parsed.promoWindows !== undefined ? { promoWindows: parsed.promoWindows } : {}),
        ...(parsed.closures !== undefined ? { closures: parsed.closures } : {}),
        ...(parsed.note !== undefined ? { note: parsed.note } : {}),
        ...(opts.confirmedBy !== undefined ? { confirmedBy: opts.confirmedBy } : {}),
        confirmedAt: opts.confirmedAt,
      },
    });
    const confirmation = rowToConfirmation(row);
    if (!confirmation) {
      // Unreachable when the write path validated above; guard regardless so
      // a future schema/column divergence fails loudly at the write, not
      // silently at a 4c read.
      throw new Error("operational-state confirmation failed round-trip validation");
    }
    return confirmation;
  }

  /**
   * Latest confirmation for an org, or null when none exists (honest
   * absence). A malformed latest row degrades to null rather than falling
   * back to an older row: claiming older knowledge as current would
   * overstate freshness.
   */
  async getLatest(organizationId: string): Promise<OperationalStateConfirmation | null> {
    const row = await this.prisma.operationalStateConfirmation.findFirst({
      where: { organizationId },
      orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    return row ? rowToConfirmation(row) : null;
  }

  /**
   * Every confirmation whose DERIVED validity interval overlaps the (past)
   * attribution window [windowStart, windowEnd], oldest first. Concretely:
   * the latest confirmation at-or-before windowStart (the state regime in
   * force as the window opened) plus every confirmation inside
   * (windowStart, windowEnd]. Empty array = the org's operational context
   * over that window is unknown (honest absence; legacy orgs have zero rows
   * by construction).
   *
   * Slice 4c builds businessContextStable on top of this set: it can detect
   * disruptive states governing the window, detect mid-window regime changes
   * (a promo starting mid-window breaks pre/post comparability), and apply
   * its own staleness policy using each confirmation's confirmedAt.
   */
  async getConfirmationsOverlappingWindow(
    organizationId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<OperationalStateConfirmation[]> {
    const [governing, inWindow] = await Promise.all([
      this.prisma.operationalStateConfirmation.findFirst({
        where: { organizationId, confirmedAt: { lte: windowStart } },
        orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.operationalStateConfirmation.findMany({
        where: { organizationId, confirmedAt: { gt: windowStart, lte: windowEnd } },
        orderBy: [{ confirmedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    const rows = [...(governing ? [governing] : []), ...inWindow];
    return rows
      .map((row) => rowToConfirmation(row))
      .filter((c): c is OperationalStateConfirmation => c !== null);
  }
}
