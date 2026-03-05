// ---------------------------------------------------------------------------
// Provider Interfaces — Calendar, SMS, ReviewPlatform
// ---------------------------------------------------------------------------

import type { AppointmentDetails, AppointmentSlot, ReviewDetails } from "../../core/types.js";
import type { PlatformHealth } from "../types.js";

// ---------------------------------------------------------------------------
// Calendar Provider
// ---------------------------------------------------------------------------

export interface CalendarProvider {
  readonly platform: "google" | "mock";

  /** Book an appointment slot */
  bookAppointment(
    calendarId: string,
    contactId: string,
    startTime: Date,
    endTime: Date,
    title: string,
    notes?: string,
  ): Promise<AppointmentDetails>;

  /** Cancel an existing appointment */
  cancelAppointment(
    calendarId: string,
    appointmentId: string,
  ): Promise<{ success: boolean; previousStatus: string }>;

  /** Reschedule an appointment */
  rescheduleAppointment(
    calendarId: string,
    appointmentId: string,
    newStartTime: Date,
    newEndTime: Date,
  ): Promise<AppointmentDetails>;

  /** Get available slots for a date range */
  getAvailableSlots(
    calendarId: string,
    startDate: Date,
    endDate: Date,
    durationMinutes: number,
  ): Promise<AppointmentSlot[]>;

  /** Health check */
  checkHealth(): Promise<PlatformHealth>;
}

// ---------------------------------------------------------------------------
// SMS Provider
// ---------------------------------------------------------------------------

export interface SMSProvider {
  readonly platform: "twilio" | "mock";

  /** Send an SMS message */
  sendMessage(
    to: string,
    from: string,
    body: string,
  ): Promise<{ messageId: string; status: string }>;

  /** Health check */
  checkHealth(): Promise<PlatformHealth>;
}

// ---------------------------------------------------------------------------
// Review Platform Provider
// ---------------------------------------------------------------------------

export interface ReviewPlatformProvider {
  readonly platform: "google" | "mock";

  /** Request a review from a customer */
  sendReviewRequest(
    contactId: string,
    locationId: string,
    message: string,
  ): Promise<{ requestId: string; status: string }>;

  /** Post a response to a review */
  respondToReview(
    reviewId: string,
    locationId: string,
    responseText: string,
  ): Promise<{ success: boolean }>;

  /** Fetch recent reviews */
  getReviews(locationId: string, limit: number): Promise<ReviewDetails[]>;

  /** Health check */
  checkHealth(): Promise<PlatformHealth>;
}
