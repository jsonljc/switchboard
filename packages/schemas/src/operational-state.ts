import { z } from "zod";

/**
 * Operational state of the business: time-anchored, operator-confirmed
 * conditions (Riley v3 slice 4a; spec 2026-06-03-riley-v3-control-plane
 * sections 2.1 net-new paragraph and 7.4).
 *
 * Deliberately a SIBLING of BusinessFactsSchema (marketplace.ts), not an
 * extension of it: BusinessFacts is durable identity written whole-blob by
 * the operator editor, while operational state is a stream of dated
 * confirmations whose freshness anchor must never move under unrelated
 * identity edits.
 *
 * HONESTY FLOOR: every dimension is optional and nothing carries a default.
 * An absent dimension means "the operator has not confirmed this", never
 * "open"/"normal". For the interval lists, undefined means unconfirmed while
 * an explicit empty array means "operator confirmed none". A free-text note
 * alone never counts as a confirmation (it would create a freshness anchor
 * with no machine-readable content); the same floor is mirrored by a
 * database CHECK constraint.
 */

/**
 * A bounded condition the operator knows explicit dates for (promo, closure).
 * Bounds are ISO-8601 instants; the operator-editor surface (4b) converts
 * operator-local dates using the org timezone at the edge. `end` is optional:
 * open-ended ("until further notice") conditions are real. When present,
 * `end` must be strictly after `start`: inverted and zero-length intervals
 * are rejected here so the slice-4c overlap check never has to guess what
 * they meant.
 */
export const OperationalIntervalSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime().optional(),
    label: z.string().min(1).optional(),
  })
  .refine(
    (interval) =>
      interval.end === undefined || Date.parse(interval.end) > Date.parse(interval.start),
    { message: "interval end must be strictly after start" },
  );

export type OperationalInterval = z.infer<typeof OperationalIntervalSchema>;

export const OPERATING_STATUS_VALUES = ["open", "temporarily_closed"] as const;
export const STAFFING_VALUES = ["normal", "shortfall"] as const;
export const INVENTORY_VALUES = ["normal", "outage"] as const;

export const OperationalStateSchema = z
  .object({
    operatingStatus: z.enum(OPERATING_STATUS_VALUES).optional(),
    staffing: z.enum(STAFFING_VALUES).optional(),
    inventory: z.enum(INVENTORY_VALUES).optional(),
    promoWindows: z.array(OperationalIntervalSchema).optional(),
    closures: z.array(OperationalIntervalSchema).optional(),
    note: z.string().min(1).optional(),
  })
  .refine(
    (state) =>
      state.operatingStatus !== undefined ||
      state.staffing !== undefined ||
      state.inventory !== undefined ||
      state.promoWindows !== undefined ||
      state.closures !== undefined,
    {
      message:
        "an operational-state confirmation must confirm at least one operational dimension (a note alone is not a confirmation)",
    },
  );

export type OperationalState = z.infer<typeof OperationalStateSchema>;

/**
 * A persisted operator confirmation. Append-only: rows are never updated, so
 * `confirmedAt` (the spec-7.4 freshness anchor: when the operator last
 * confirmed) is structurally immune to unrelated writes. A confirmation's
 * validity interval is DERIVED, not stored:
 * [confirmedAt_i, confirmedAt_of_next_row), open-ended for the latest row,
 * with same-instant ties broken by createdAt then id (the later row
 * supersedes; a zero-length prior interval is acceptable). That derivation
 * is what lets the slice-4c outcome path check overlap against a PAST
 * attribution window (windowStartedAt..windowEndedAt) instead of "was
 * edited recently".
 */
export const OperationalStateConfirmationSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  state: OperationalStateSchema,
  confirmedBy: z.string().min(1).nullable(),
  confirmedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});

export type OperationalStateConfirmation = z.infer<typeof OperationalStateConfirmationSchema>;
