// ---------------------------------------------------------------------------
// Advisor Registry — resolves advisors by clinic type
// ---------------------------------------------------------------------------

import type { ClinicType } from "../core/types.js";
import type { JourneyFindingAdvisor } from "./types.js";

// Qualification advisors
import {
  leadQualityAdvisor,
  intentStrengthAdvisor,
  urgencyAdvisor,
  medicalFlagAdvisor,
} from "./qualification/index.js";

// Engagement advisors
import {
  responseTimeAdvisor,
  followupComplianceAdvisor,
  conversationQualityAdvisor,
  messageFrequencyAdvisor,
} from "./engagement/index.js";

// Scheduling advisors
import {
  bookingRateAdvisor,
  noShowAdvisor,
  cancellationPatternAdvisor,
  slotUtilizationAdvisor,
} from "./scheduling/index.js";

// Revenue advisors
import {
  conversionRateAdvisor,
  atvTrendAdvisor,
  upsellAdvisor,
  ltvTrendAdvisor,
} from "./revenue/index.js";

// Reputation advisors
import {
  reviewVelocityAdvisor,
  sentimentTrendAdvisor,
  referralConversionAdvisor,
} from "./reputation/index.js";

// Compliance advisors
import {
  consentStatusAdvisor,
  communicationFrequencyAdvisor,
  escalationRateAdvisor,
  dataRetentionAdvisor,
  medicalClaimAdvisor,
} from "./compliance/index.js";

/**
 * Resolve advisors for a clinic type. All advisors are universal —
 * clinic type affects which specialty-specific advisors are included.
 *
 * All 24 advisors are pure functions with zero LLM dependency.
 */
export function resolveAdvisors(_clinicType: ClinicType): JourneyFindingAdvisor[] {
  const advisors: JourneyFindingAdvisor[] = [];

  // 1. Qualification (4) — always included
  advisors.push(leadQualityAdvisor);
  advisors.push(intentStrengthAdvisor);
  advisors.push(urgencyAdvisor);
  advisors.push(medicalFlagAdvisor);

  // 2. Engagement (4) — always included
  advisors.push(responseTimeAdvisor);
  advisors.push(followupComplianceAdvisor);
  advisors.push(conversationQualityAdvisor);
  advisors.push(messageFrequencyAdvisor);

  // 3. Scheduling (4) — always included
  advisors.push(bookingRateAdvisor);
  advisors.push(noShowAdvisor);
  advisors.push(cancellationPatternAdvisor);
  advisors.push(slotUtilizationAdvisor);

  // 4. Revenue (4) — always included
  advisors.push(conversionRateAdvisor);
  advisors.push(atvTrendAdvisor);
  advisors.push(upsellAdvisor);
  advisors.push(ltvTrendAdvisor);

  // 5. Reputation (3) — always included
  advisors.push(reviewVelocityAdvisor);
  advisors.push(sentimentTrendAdvisor);
  advisors.push(referralConversionAdvisor);

  // 6. Compliance (5) — always included
  advisors.push(consentStatusAdvisor);
  advisors.push(communicationFrequencyAdvisor);
  advisors.push(escalationRateAdvisor);
  advisors.push(dataRetentionAdvisor);
  advisors.push(medicalClaimAdvisor);

  return advisors;
}
