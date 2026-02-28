/**
 * Error types for Stripe API responses.
 * Stripe returns errors in shape: { error: { message, type, code, param } }
 */

export class StripeApiError extends Error {
  constructor(
    message: string,
    public readonly type: string,
    public readonly code: string,
    public readonly param?: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

/** Thrown when Stripe API returns 429 (rate limit exceeded). */
export class StripeRateLimitError extends StripeApiError {
  constructor(message: string) {
    super(message, "rate_limit_error", "rate_limit", undefined, 429);
    this.name = "StripeRateLimitError";
  }
}

/** Thrown when Stripe API returns 401 (invalid API key). */
export class StripeAuthError extends StripeApiError {
  constructor(message: string) {
    super(message, "authentication_error", "auth_failed", undefined, 401);
    this.name = "StripeAuthError";
  }
}

/** Thrown when the requested Stripe resource does not exist. */
export class StripeNotFoundError extends StripeApiError {
  constructor(resource: string, id: string) {
    super(
      `No such ${resource}: '${id}'`,
      "invalid_request_error",
      "resource_missing",
      resource,
      404,
    );
    this.name = "StripeNotFoundError";
  }
}
