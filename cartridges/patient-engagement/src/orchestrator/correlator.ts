// ---------------------------------------------------------------------------
// Cross-stage Pattern Detection
// ---------------------------------------------------------------------------

import type { JourneyDiagnosticResult, JourneyFinding } from "../core/types.js";

/**
 * Detect patterns that span multiple journey stages.
 */
export function detectCorrelations(result: JourneyDiagnosticResult): JourneyFinding[] {
  const findings: JourneyFinding[] = [];

  // Pattern: Both qualification AND booking dropping = systemic lead issue
  const qualStage = result.stageAnalysis.find((s) => s.stageId === "qualified");
  const bookStage = result.stageAnalysis.find((s) => s.stageId === "consultation_booked");

  if (qualStage && bookStage && qualStage.deltaPercent < -10 && bookStage.deltaPercent < -10) {
    findings.push({
      severity: "warning",
      stage: "cross-stage",
      message: `Both qualification (${qualStage.deltaPercent.toFixed(1)}%) and booking (${bookStage.deltaPercent.toFixed(1)}%) are declining — indicates a systemic lead quality issue.`,
      recommendation: "Audit lead sources and marketing spend allocation.",
    });
  }

  // Pattern: Treatment proposed dropping but accepted stable = pricing issue
  const proposedStage = result.stageAnalysis.find((s) => s.stageId === "treatment_proposed");
  const acceptedStage = result.stageAnalysis.find((s) => s.stageId === "treatment_accepted");

  if (
    proposedStage &&
    acceptedStage &&
    proposedStage.deltaPercent < -15 &&
    Math.abs(acceptedStage.deltaPercent) < 5
  ) {
    findings.push({
      severity: "info",
      stage: "cross-stage",
      message:
        "Treatment proposals dropping while acceptance rate is stable — fewer patients reaching treatment discussion.",
      recommendation: "Focus on improving consultation-to-proposal conversion.",
    });
  }

  // Pattern: High no-show + low booking = schedule management issue
  const totalPatients = result.totalPatients.current;
  if (totalPatients > 20) {
    const bookingDropoff = result.dropoffs.find(
      (d) => d.fromStage === "Qualified" && d.toStage === "Consultation Booked",
    );
    const completionDropoff = result.dropoffs.find(
      (d) => d.fromStage === "Consultation Booked" && d.toStage === "Consultation Completed",
    );

    if (
      bookingDropoff &&
      completionDropoff &&
      bookingDropoff.currentRate < 0.4 &&
      completionDropoff.currentRate < 0.7
    ) {
      findings.push({
        severity: "warning",
        stage: "cross-stage",
        message:
          "Low booking rate combined with low completion rate suggests schedule management friction.",
        recommendation:
          "Simplify booking flow, add online scheduling, and implement confirmation reminders.",
      });
    }
  }

  return findings;
}
