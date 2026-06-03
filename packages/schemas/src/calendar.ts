import { z } from "zod";

export const SlotQuerySchema = z.object({
  dateFrom: z.string(),
  dateTo: z.string(),
  durationMinutes: z.number().int().positive(),
  service: z.string().min(1),
  timezone: z.string().min(1),
  bufferMinutes: z.number().int().nonnegative().default(15),
});
export type SlotQuery = z.infer<typeof SlotQuerySchema>;

export const TimeSlotSchema = z.object({
  start: z.string(),
  end: z.string(),
  calendarId: z.string(),
  available: z.boolean(),
});
export type TimeSlot = z.infer<typeof TimeSlotSchema>;

export const BookingStatusSchema = z.enum([
  "pending_confirmation",
  "confirmed",
  "cancelled",
  "no_show",
  "completed",
  "failed",
]);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const BookingSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  organizationId: z.string(),
  opportunityId: z.string().nullable().optional(),
  service: z.string(),
  status: BookingStatusSchema,
  calendarEventId: z.string().nullable().optional(),
  attendeeName: z.string().nullable().optional(),
  attendeeEmail: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdByType: z.enum(["agent", "human", "contact"]),
  sourceChannel: z.string().nullable().optional(),
  workTraceId: z.string().nullable().optional(),
  rescheduledAt: z.string().nullable().optional(),
  rescheduleCount: z.number().int().nonnegative().default(0),
  startsAt: z.string(),
  endsAt: z.string(),
  timezone: z.string().default("Asia/Singapore"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Booking = z.infer<typeof BookingSchema>;

export const CreateBookingInputSchema = z.object({
  contactId: z.string().min(1),
  organizationId: z.string().min(1),
  opportunityId: z.string().nullable().optional(),
  slot: TimeSlotSchema,
  service: z.string().min(1),
  attendeeName: z.string().nullable().optional(),
  attendeeEmail: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdByType: z.enum(["agent", "human", "contact"]).default("agent"),
  sourceChannel: z.string().nullable().optional(),
  workTraceId: z.string().nullable().optional(),
});
export type CreateBookingInput = z.infer<typeof CreateBookingInputSchema>;

export const BusinessHoursConfigSchema = z.object({
  timezone: z.string().min(1),
  days: z.array(
    z.object({
      day: z.number().int().min(0).max(6),
      open: z.string().regex(/^\d{2}:\d{2}$/),
      close: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  ),
  defaultDurationMinutes: z.number().int().positive(),
  bufferMinutes: z.number().int().nonnegative(),
  slotIncrementMinutes: z.number().int().positive().default(30),
});
export type BusinessHoursConfig = z.infer<typeof BusinessHoursConfigSchema>;

export const CalendarHealthCheckSchema = z.object({
  status: z.enum(["connected", "disconnected", "degraded"]),
  latencyMs: z.number(),
  error: z.string().nullable().optional(),
});
export type CalendarHealthCheck = z.infer<typeof CalendarHealthCheckSchema>;

export interface CalendarProvider {
  listAvailableSlots(query: SlotQuery): Promise<TimeSlot[]>;
  createBooking(input: CreateBookingInput): Promise<Booking>;
  cancelBooking(bookingId: string, reason?: string): Promise<void>;
  rescheduleBooking(bookingId: string, newSlot: TimeSlot): Promise<Booking>;
  getBooking(bookingId: string): Promise<Booking | null>;
  healthCheck(): Promise<CalendarHealthCheck>;
}

/**
 * Thrown by the durable booking write when a NEW booking would overlap an
 * existing LIVE booking (status not in failed/cancelled) for the same org.
 * Detected structurally across the core/db package boundary via the `code`
 * field (mirrors the P2002 detection in calendar-book.ts), so an `instanceof`
 * mismatch between duplicate schema builds cannot silently swallow it.
 */
export class BookingSlotConflictError extends Error {
  readonly code = "SLOT_CONFLICT" as const;
  constructor(public readonly conflictingBookingId: string) {
    super("An overlapping booking already exists for this slot.");
    this.name = "BookingSlotConflictError";
  }
}

export function isBookingSlotConflictError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "SLOT_CONFLICT"
  );
}
