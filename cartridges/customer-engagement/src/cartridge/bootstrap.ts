// ---------------------------------------------------------------------------
// Bootstrap Factory — bootstrapCustomerEngagementCartridge()
// ---------------------------------------------------------------------------

import type { Cartridge, CartridgeInterceptor } from "@switchboard/cartridge-sdk";
import type { BusinessProfile } from "@switchboard/schemas";
import type { CustomerEngagementConfig } from "./types.js";

import { CustomerEngagementCartridge } from "./index.js";
import { IntakeAgent } from "../agents/intake/index.js";
import { SchedulingAgent } from "../agents/scheduling/index.js";
import { FollowupAgent } from "../agents/followup/index.js";
import { RetentionAgent } from "../agents/retention/index.js";

// Providers
import { MockCalendarProvider } from "./providers/calendar/mock-calendar.js";
import { MockSMSProvider } from "./providers/sms/mock-sms.js";
import { MockReviewProvider } from "./providers/review/mock-review.js";
import { GoogleCalendarProvider } from "./providers/calendar/google-calendar.js";
import { TwilioSMSProvider } from "./providers/sms/twilio.js";
import { GoogleReviewsProvider } from "./providers/review/google-reviews.js";

// Interceptors
import { HIPAARedactor } from "./interceptors/hipaa-redactor.js";
import { MedicalClaimFilter } from "./interceptors/medical-claim-filter.js";
import { ConsentGate } from "./interceptors/consent-gate.js";

export interface BootstrapResult {
  cartridge: Cartridge;
  interceptors: CartridgeInterceptor[];
}

export async function bootstrapCustomerEngagementCartridge(
  config: CustomerEngagementConfig = {},
  profile?: BusinessProfile,
): Promise<BootstrapResult> {
  const cartridge = new CustomerEngagementCartridge();

  // Inject profile data if available
  if (profile) {
    cartridge.setProfile(profile);
  }

  // Resolve providers
  const useMocks = !config.requireCredentials;

  const calendar =
    config.calendarApiKey && config.calendarId
      ? new GoogleCalendarProvider({
          accessToken: config.calendarApiKey,
          calendarId: config.calendarId,
        })
      : useMocks
        ? new MockCalendarProvider()
        : new MockCalendarProvider();

  const sms =
    config.twilioAccountSid && config.twilioAuthToken && config.twilioPhoneNumber
      ? new TwilioSMSProvider({
          accountSid: config.twilioAccountSid,
          authToken: config.twilioAuthToken,
          fromNumber: config.twilioPhoneNumber,
        })
      : useMocks
        ? new MockSMSProvider()
        : new MockSMSProvider();

  const review =
    config.googleBusinessApiKey && config.googleBusinessLocationId
      ? new GoogleReviewsProvider({
          accessToken: config.googleBusinessApiKey,
          accountId: config.googleBusinessLocationId,
          locationId: config.googleBusinessLocationId,
        })
      : useMocks
        ? new MockReviewProvider()
        : new MockReviewProvider();

  cartridge.setProviders(calendar, sms, review);

  // Register agents
  const calendarId = config.calendarId ?? "default";
  const fromNumber = config.twilioPhoneNumber ?? "+10000000000";
  const locationId = config.googleBusinessLocationId ?? "default";

  cartridge.registerAgent(new IntakeAgent());
  cartridge.registerAgent(new SchedulingAgent(calendar, sms, calendarId, fromNumber));
  cartridge.registerAgent(new FollowupAgent(review, locationId));
  cartridge.registerAgent(new RetentionAgent());

  // Interceptors — conditionally enabled based on profile compliance flags
  const interceptors: CartridgeInterceptor[] = [];

  const enableHipaa = profile?.compliance?.enableHipaaRedactor ?? true;
  const enableConsent = profile?.compliance?.enableConsentGate ?? true;
  const enableMedicalClaim = profile?.compliance?.enableMedicalClaimFilter ?? true;

  if (enableHipaa) interceptors.push(new HIPAARedactor());
  if (enableConsent) interceptors.push(new ConsentGate());
  if (enableMedicalClaim) interceptors.push(new MedicalClaimFilter());

  return { cartridge, interceptors };
}
