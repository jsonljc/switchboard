/**
 * Error types for Meta Marketing API responses.
 * Meta returns errors in shape: { error: { message, type, code, error_subcode, fbtrace_id } }
 */

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly subcode: number,
    public readonly type: string,
    public readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** Thrown when Meta API returns code 17 (rate limit exceeded). */
export class MetaRateLimitError extends MetaApiError {
  constructor(
    message: string,
    subcode: number,
    fbtraceId?: string,
  ) {
    super(message, 17, subcode, "OAuthException", fbtraceId);
    this.name = "MetaRateLimitError";
  }
}

/** Thrown when Meta API returns code 190 (invalid/expired access token). */
export class MetaAuthError extends MetaApiError {
  constructor(
    message: string,
    subcode: number,
    fbtraceId?: string,
  ) {
    super(message, 190, subcode, "OAuthException", fbtraceId);
    this.name = "MetaAuthError";
  }
}
