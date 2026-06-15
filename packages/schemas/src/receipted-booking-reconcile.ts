import { z } from "zod";
import { AttributionConfidenceSchema, ExceptionCodeSchema } from "./receipted-booking.js";

/**
 * Parameters for the `receipt.reconcile_booking` operator intent. One governed intent, three actions,
 * discriminated on `action` (spec 2026-06-15-receipted-booking-override.md, Decision 2). The executor
 * branches on the discriminant; the route + governance footprint stays a single surface.
 *
 * - override_attribution: the owner asserts the correct attribution. Writes the override COLUMNS;
 *   producer for the column-derived `manual_override`.
 * - flag_duplicate: the owner asserts a probable duplicate contact. Appends an open
 *   `duplicate_contact_risk` entry to the persisted `exceptions` array.
 * - resolve_exception: stamps `resolvedAt` on the matching open array entry. The schema accepts the
 *   full `ExceptionCode` enum for forward-compat; the executor rejects v1-unsupported codes.
 */
export const ReconcileBookingParametersSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("override_attribution"),
    bookingId: z.string().min(1),
    confidence: AttributionConfidenceSchema,
    reason: z.string().min(1).max(500),
  }),
  z.object({
    action: z.literal("flag_duplicate"),
    bookingId: z.string().min(1),
    detail: z.string().min(1).max(500),
  }),
  z.object({
    action: z.literal("resolve_exception"),
    bookingId: z.string().min(1),
    code: ExceptionCodeSchema,
  }),
]);

export type ReconcileBookingParameters = z.infer<typeof ReconcileBookingParametersSchema>;
