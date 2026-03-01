// ---------------------------------------------------------------------------
// Raw types returned by the Meta Graph API /insights endpoint
// ---------------------------------------------------------------------------

export interface MetaActionValue {
  action_type: string;
  value: string;
}

export interface MetaInsightsRow {
  date_start: string;
  date_stop: string;
  spend: string;
  impressions: string;
  inline_link_clicks?: string;
  clicks?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  frequency?: string;
  actions?: MetaActionValue[];
  cost_per_action_type?: MetaActionValue[];
  action_values?: MetaActionValue[];
  website_purchase_roas?: MetaActionValue[];
}

export interface MetaInsightsResponse {
  data: MetaInsightsRow[];
  paging?: {
    cursors?: { before: string; after: string };
    next?: string;
  };
}

export interface MetaApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export interface MetaApiConfig {
  accessToken: string;
  apiVersion?: string;
  /** Max requests per second (Meta default rate limit) */
  maxRequestsPerSecond?: number;
  /** Max retries on transient errors */
  maxRetries?: number;
}
