// ---------------------------------------------------------------------------
// Mock Review Platform Provider
// ---------------------------------------------------------------------------

import type { ReviewPlatformProvider } from "../provider.js";
import type { ReviewDetails } from "../../../core/types.js";
import type { PlatformHealth } from "../../types.js";

export class MockReviewProvider implements ReviewPlatformProvider {
  readonly platform = "mock" as const;
  readonly sentRequests: Array<{ contactId: string; message: string }> = [];
  readonly responses: Array<{ reviewId: string; responseText: string }> = [];
  private nextId = 1;

  async sendReviewRequest(
    contactId: string,
    _locationId: string,
    message: string,
  ): Promise<{ requestId: string; status: string }> {
    const requestId = `mock-review-req-${this.nextId++}`;
    this.sentRequests.push({ contactId, message });
    return { requestId, status: "sent" };
  }

  async respondToReview(
    reviewId: string,
    _locationId: string,
    responseText: string,
  ): Promise<{ success: boolean }> {
    this.responses.push({ reviewId, responseText });
    return { success: true };
  }

  async getReviews(_locationId: string, limit: number): Promise<ReviewDetails[]> {
    const reviews: ReviewDetails[] = [];
    for (let i = 0; i < Math.min(limit, 3); i++) {
      reviews.push({
        reviewId: `mock-review-${i + 1}`,
        platform: "google",
        contactId: null,
        rating: 4 + (i % 2),
        text: "Great experience!",
        createdAt: new Date(),
        respondedAt: null,
        responseText: null,
      });
    }
    return reviews;
  }

  async checkHealth(): Promise<PlatformHealth> {
    return { status: "connected", latencyMs: 1, error: null };
  }
}
