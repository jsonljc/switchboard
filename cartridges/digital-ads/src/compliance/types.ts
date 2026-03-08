export interface AdReviewStatus {
  adId: string;
  adName: string;
  effectiveStatus: string;
  reviewFeedback: Array<{ type: string; body: string }>;
  policyViolations: string[];
}

export interface ComplianceAuditResult {
  accountId: string;
  auditedAt: string;
  disapprovedAds: AdReviewStatus[];
  adsWithIssues: AdReviewStatus[];
  specialAdCategoriesConfigured: boolean;
  specialAdCategories: string[];
  pixelHealthy: boolean;
  capiConfigured: boolean;
  overallScore: number; // 0-100
  issues: string[];
  recommendations: string[];
}

export interface PublisherBlocklist {
  id: string;
  name: string;
  publishers: string[];
  createdAt: string | null;
}

export interface ContentExclusionConfig {
  campaignId: string;
  excludedPublisherCategories: string[];
  brandSafetyContentFilterLevel: string;
}
