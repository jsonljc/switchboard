// ---------------------------------------------------------------------------
// Deployment Readiness Checker — validates config before go-live
// ---------------------------------------------------------------------------

import type { BusinessProfile } from "@switchboard/schemas";

export interface ReadinessCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: "critical" | "warning" | "info";
}

export interface ReadinessResult {
  ready: boolean;
  checks: ReadinessCheck[];
  score: number;
}

export class DeploymentReadinessChecker {
  check(profile: BusinessProfile, channelConfigured?: boolean): ReadinessResult {
    const checks: ReadinessCheck[] = [];

    // Business info
    checks.push(this.checkRequired("business_name", !!profile.business.name, "Business name"));
    checks.push(this.checkRequired("business_phone", !!profile.business.phone, "Business phone"));
    checks.push(this.checkRequired("business_timezone", !!profile.business.timezone, "Timezone"));

    // Services
    checks.push(
      this.checkRequired(
        "services_catalog",
        profile.services.catalog.length > 0,
        "Service catalog (at least 1 service)",
      ),
    );

    // Hours
    checks.push({
      name: "operating_hours",
      passed: !!profile.hours && Object.keys(profile.hours).length > 0,
      message: profile.hours ? "Operating hours configured" : "Operating hours not set",
      severity: "warning",
    });

    // FAQs
    checks.push({
      name: "faqs",
      passed: !!profile.faqs && profile.faqs.length >= 3,
      message:
        profile.faqs && profile.faqs.length >= 3
          ? `${profile.faqs.length} FAQs configured`
          : "Recommend at least 3 FAQs",
      severity: "warning",
    });

    // Escalation config
    checks.push({
      name: "escalation_config",
      passed: !!profile.escalationConfig?.contacts?.length,
      message: profile.escalationConfig?.contacts?.length
        ? "Escalation contacts configured"
        : "No escalation contacts configured",
      severity: "critical",
    });

    // Booking config
    checks.push({
      name: "booking_config",
      passed: !!(profile.booking?.bookingUrl || profile.booking?.bookingPhone),
      message:
        profile.booking?.bookingUrl || profile.booking?.bookingPhone
          ? "Booking method configured"
          : "No booking URL or phone configured",
      severity: "warning",
    });

    // Channel
    checks.push({
      name: "channel_configured",
      passed: !!channelConfigured,
      message: channelConfigured
        ? "At least one channel is active"
        : "No active channel configured",
      severity: "critical",
    });

    // Persona
    checks.push({
      name: "persona",
      passed: !!profile.persona?.name,
      message: profile.persona?.name
        ? `Agent persona: ${profile.persona.name}`
        : "No agent persona configured",
      severity: "info",
    });

    // Compliance
    if (profile.compliance?.enableHipaaRedactor || profile.compliance?.enableMedicalClaimFilter) {
      checks.push({
        name: "compliance_flags",
        passed: true,
        message: "Medical compliance filters enabled",
        severity: "info",
      });
    }

    const criticalPassed = checks.filter((c) => c.severity === "critical").every((c) => c.passed);
    const totalPassed = checks.filter((c) => c.passed).length;
    const score = Math.round((totalPassed / checks.length) * 100);

    return {
      ready: criticalPassed,
      checks,
      score,
    };
  }

  private checkRequired(name: string, condition: boolean, label: string): ReadinessCheck {
    return {
      name,
      passed: condition,
      message: condition ? `${label} is set` : `${label} is required`,
      severity: "critical",
    };
  }
}
