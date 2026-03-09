// ---------------------------------------------------------------------------
// Shared Meta API error classes
// ---------------------------------------------------------------------------

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

export class MetaRateLimitError extends MetaApiError {
  constructor(message: string, subcode: number, fbtraceId?: string) {
    super(message, 17, subcode, "OAuthException", fbtraceId);
    this.name = "MetaRateLimitError";
  }
}

export class MetaAuthError extends MetaApiError {
  constructor(message: string, code: number, subcode: number, fbtraceId?: string) {
    super(message, code, subcode, "OAuthException", fbtraceId);
    this.name = "MetaAuthError";
  }
}
