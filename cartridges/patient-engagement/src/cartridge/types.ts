// ---------------------------------------------------------------------------
// Patient Engagement Cartridge — Internal Types
// ---------------------------------------------------------------------------

import type { GuardrailConfig, RiskInput } from "@switchboard/schemas";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";

export type { ExecuteResult };
export type { RiskInput };
export type { GuardrailConfig };

// ---------------------------------------------------------------------------
// Session / Connection State
// ---------------------------------------------------------------------------

export interface CalendarConnection {
  provider: "google" | "mock";
  connected: boolean;
  calendarId: string | null;
}

export interface SMSConnection {
  provider: "twilio" | "mock";
  connected: boolean;
  phoneNumber: string | null;
}

export interface ReviewConnection {
  provider: "google" | "mock";
  connected: boolean;
  locationId: string | null;
}

export interface SessionState {
  calendar: CalendarConnection | null;
  sms: SMSConnection | null;
  review: ReviewConnection | null;
}

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

export interface PatientEngagementConfig {
  calendarApiKey?: string;
  calendarId?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  googleBusinessLocationId?: string;
  googleBusinessApiKey?: string;
  requireCredentials?: boolean;
}

// ---------------------------------------------------------------------------
// Platform Health (mirrors digital-ads pattern)
// ---------------------------------------------------------------------------

export interface PlatformHealth {
  status: "connected" | "degraded" | "disconnected";
  latencyMs: number;
  error: string | null;
}
