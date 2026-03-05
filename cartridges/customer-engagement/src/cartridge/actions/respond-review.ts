// ---------------------------------------------------------------------------
// Action: customer-engagement.review.respond
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ReviewPlatformProvider } from "../providers/provider.js";

export async function executeRespondReview(
  params: Record<string, unknown>,
  review: ReviewPlatformProvider,
  locationId: string,
): Promise<ExecuteResult> {
  const start = Date.now();
  const reviewId = params.reviewId as string;
  const responseText = params.responseText as string;

  try {
    const result = await review.respondToReview(reviewId, locationId, responseText);

    return {
      success: result.success,
      summary: `Responded to review ${reviewId}`,
      externalRefs: { reviewId },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Failed to respond to review: ${errorMsg}`,
      externalRefs: { reviewId },
      rollbackAvailable: false,
      partialFailures: [{ step: "respond_review", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
