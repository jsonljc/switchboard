// ---------------------------------------------------------------------------
// Action: patient-engagement.review.request
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ReviewPlatformProvider } from "../providers/provider.js";

export async function executeRequestReview(
  params: Record<string, unknown>,
  review: ReviewPlatformProvider,
  locationId: string,
): Promise<ExecuteResult> {
  const start = Date.now();
  const patientId = params.patientId as string;
  const message =
    (params.message as string) ?? "We'd love your feedback! Please leave us a review.";

  try {
    const result = await review.sendReviewRequest(patientId, locationId, message);

    return {
      success: true,
      summary: `Sent review request to patient ${patientId}`,
      externalRefs: { patientId, requestId: result.requestId },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Failed to send review request: ${errorMsg}`,
      externalRefs: { patientId },
      rollbackAvailable: false,
      partialFailures: [{ step: "send_review_request", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
