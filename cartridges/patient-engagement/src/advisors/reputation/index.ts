// ---------------------------------------------------------------------------
// Reputation Advisors (3 advisors)
// ---------------------------------------------------------------------------

import type { JourneyFindingAdvisor } from "../types.js";
import { percentChange } from "../../core/analysis/significance.js";

/**
 * Review Velocity — tracks rate of new reviews.
 */
export const reviewVelocityAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  previous,
) => {
  const currentCount = current.aggregates.reviewCount;
  const previousCount = previous.aggregates.reviewCount;

  if (previousCount === 0 && currentCount === 0) return [];

  const delta = percentChange(currentCount, previousCount);

  if (currentCount < 3 && current.totalPatients > 50) {
    return [
      {
        severity: "warning",
        stage: "review_velocity",
        message: `Only ${currentCount} reviews received this period despite ${current.totalPatients} patients.`,
        recommendation:
          "Implement post-treatment review solicitation. Send requests within 48 hours of treatment.",
      },
    ];
  }

  if (delta < -30 && previousCount > 5) {
    return [
      {
        severity: "info",
        stage: "review_velocity",
        message: `Review velocity dropped ${delta.toFixed(1)}% PoP (${previousCount} → ${currentCount}).`,
        recommendation: "Review timing and frequency of review requests.",
      },
    ];
  }

  return [];
};

/**
 * Sentiment Trend — tracks average review ratings.
 */
export const sentimentTrendAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  previous,
) => {
  const currentRating = current.aggregates.reviewRating;
  const previousRating = previous.aggregates.reviewRating;

  if (currentRating === null || previousRating === null) return [];

  if (currentRating < 3.5) {
    return [
      {
        severity: "critical",
        stage: "sentiment_trend",
        message: `Average review rating is ${currentRating.toFixed(1)}/5.0 — below 3.5 threshold.`,
        recommendation:
          "Address recurring complaints immediately. Respond to all negative reviews within 24 hours.",
      },
    ];
  }

  if (currentRating < previousRating - 0.3) {
    return [
      {
        severity: "warning",
        stage: "sentiment_trend",
        message: `Average review rating declined from ${previousRating.toFixed(1)} to ${currentRating.toFixed(1)}.`,
        recommendation:
          "Investigate recent negative feedback for patterns. Address systemic issues.",
      },
    ];
  }

  return [];
};

/**
 * Referral Conversion — tracks referral-generated patients.
 */
export const referralConversionAdvisor: JourneyFindingAdvisor = (
  _stageAnalysis,
  _dropoffs,
  current,
  previous,
) => {
  const currentReferrals = current.aggregates.referralCount;
  const previousReferrals = previous.aggregates.referralCount;
  const delta = percentChange(currentReferrals, previousReferrals);

  if (currentReferrals === 0 && current.totalPatients > 30) {
    return [
      {
        severity: "info",
        stage: "referral_conversion",
        message: "No referrals received this period.",
        recommendation:
          "Launch a patient referral program. Offer incentives for successful referrals.",
      },
    ];
  }

  if (delta > 30 && currentReferrals > 3) {
    return [
      {
        severity: "healthy",
        stage: "referral_conversion",
        message: `Referrals increased ${delta.toFixed(1)}% PoP (${previousReferrals} → ${currentReferrals}).`,
        recommendation: null,
      },
    ];
  }

  return [];
};
