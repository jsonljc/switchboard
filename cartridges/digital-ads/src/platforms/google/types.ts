// ---------------------------------------------------------------------------
// Google Ads API response types
// ---------------------------------------------------------------------------

/** A single row from the Google Ads GAQL reporting response */
export interface GoogleAdsRow {
  campaign?: {
    id: string;
    name: string;
    status: string;
  };
  adGroup?: {
    id: string;
    name: string;
  };
  metrics: {
    impressions?: string;
    clicks?: string;
    costMicros?: string;
    conversions?: number;
    conversionsValue?: number;
    allConversions?: number;
    ctr?: number;
    averageCpc?: number;
    averageCpm?: number;
  };
  segments?: {
    conversionAction?: string;
    conversionActionName?: string;
    date?: string;
  };
}

/** GAQL query response envelope */
export interface GoogleAdsResponse {
  results: GoogleAdsRow[];
  nextPageToken?: string;
  totalResultsCount?: string;
}

/** Error from the Google Ads API */
export interface GoogleAdsError {
  error: {
    code: number;
    message: string;
    status: string;
    details?: Array<{
      errors: Array<{
        errorCode: Record<string, string>;
        message: string;
      }>;
    }>;
  };
}

/** OAuth2 token response */
export interface GoogleOAuth2TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export interface GoogleAdsApiConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  loginCustomerId?: string;
  /** Max requests per second (default: 10) */
  maxRequestsPerSecond?: number;
  /** Max retries on transient errors (default: 3) */
  maxRetries?: number;
}
