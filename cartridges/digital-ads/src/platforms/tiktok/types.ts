// ---------------------------------------------------------------------------
// TikTok Marketing API response types
// ---------------------------------------------------------------------------

/** A single row from the TikTok Reporting API */
export interface TikTokReportRow {
  dimensions: {
    stat_time_day?: string;
    ad_id?: string;
    adgroup_id?: string;
    campaign_id?: string;
    advertiser_id?: string;
  };
  metrics: {
    spend?: string;
    impressions?: string;
    clicks?: string;
    ctr?: string;
    cpc?: string;
    cpm?: string;
    /** Page browse / view content events */
    page_browse?: string;
    /** On-site add to cart */
    onsite_add_to_cart?: string;
    /** Complete payment (purchase) */
    complete_payment?: string;
    /** Conversion count */
    conversion?: string;
    /** Total complete payment value */
    complete_payment_value?: string;
    /** Cost per complete payment */
    cost_per_complete_payment?: string;
    /** Cost per conversion */
    cost_per_conversion?: string;
    /** Form submission events */
    form_submit?: string;
    /** Cost per form submit */
    cost_per_form_submit?: string;
    /** On-site form submissions */
    onsite_form?: string;
    /** Cost per on-site form */
    cost_per_onsite_form?: string;
    /** ROAS */
    complete_payment_roas?: string;
  };
}

/** TikTok Reporting API response envelope */
export interface TikTokReportResponse {
  code: number;
  message: string;
  data: {
    list: TikTokReportRow[];
    page_info?: {
      page: number;
      page_size: number;
      total_number: number;
      total_page: number;
    };
  };
}

/** TikTok API error response */
export interface TikTokApiError {
  code: number;
  message: string;
  request_id?: string;
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export interface TikTokApiConfig {
  accessToken: string;
  appId: string;
  /** Max requests per second (default: 10) */
  maxRequestsPerSecond?: number;
  /** Max retries on transient errors (default: 3) */
  maxRetries?: number;
}
