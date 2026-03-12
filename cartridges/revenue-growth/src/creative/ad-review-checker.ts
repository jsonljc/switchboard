// ---------------------------------------------------------------------------
// Ad Review Checker — Pre-deployment creative compliance checks
// ---------------------------------------------------------------------------
// Checks a batch of creative assets against policy rules before they are
// deployed. Detects prohibited content patterns, text-to-image ratio
// issues, and landing page consistency problems.
// ---------------------------------------------------------------------------

import type { AccountProfileStore } from "../stores/interfaces.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreativeAssetForReview {
  id: string;
  type: "image" | "video" | "carousel" | "text";
  textContent: string;
  imageUrl?: string;
  landingPageUrl?: string;
  textToImageRatio?: number;
}

export interface AdReviewViolation {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface AdReviewResult {
  assetId: string;
  passed: boolean;
  violations: AdReviewViolation[];
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Prohibited content patterns
// ---------------------------------------------------------------------------

const PROHIBITED_PATTERNS: Array<{ pattern: RegExp; code: string; message: string }> = [
  {
    pattern: /\b(guaranteed|guarantee)\b/i,
    code: "PROHIBITED_GUARANTEE",
    message: "Prohibited claim: 'guaranteed' results are not allowed in ad copy",
  },
  {
    pattern: /\b(free money|get rich quick|make money fast)\b/i,
    code: "PROHIBITED_GET_RICH",
    message: "Prohibited claim: get-rich-quick language is not allowed",
  },
  {
    pattern: /\b(before\s+and\s+after)\b/i,
    code: "PROHIBITED_BEFORE_AFTER",
    message: "Prohibited pattern: before-and-after claims require special approval",
  },
  {
    pattern: /\b(miracle|cure|treat|heal)\b/i,
    code: "PROHIBITED_HEALTH_CLAIM",
    message: "Prohibited health claim: medical/health claims require regulatory approval",
  },
];

// ---------------------------------------------------------------------------
// Text-to-image ratio threshold
// ---------------------------------------------------------------------------

const MAX_TEXT_TO_IMAGE_RATIO = 0.2; // 20% text maximum

// ---------------------------------------------------------------------------
// AdReviewChecker
// ---------------------------------------------------------------------------

export class AdReviewChecker {
  /**
   * Check a batch of creative assets against ad review rules.
   */
  checkBatch(assets: CreativeAssetForReview[]): AdReviewResult[] {
    return assets.map((asset) => this.checkSingle(asset));
  }

  /**
   * Log rejection patterns to the account profile store.
   */
  async logRejections(
    results: AdReviewResult[],
    accountProfileStore?: AccountProfileStore,
  ): Promise<void> {
    if (!accountProfileStore) return;

    const rejections = results.filter((r) => !r.passed);
    if (rejections.length === 0) return;

    // Count violation codes for pattern detection
    const violationCounts = new Map<string, number>();
    for (const result of rejections) {
      for (const violation of result.violations) {
        const count = violationCounts.get(violation.code) ?? 0;
        violationCounts.set(violation.code, count + 1);
      }
    }

    // Log is informational — we store the rejection patterns
    // but don't modify the profile structure for now
    // Future: add rejectionPatterns to AccountLearningProfile
  }

  /**
   * Check a single creative asset.
   */
  private checkSingle(asset: CreativeAssetForReview): AdReviewResult {
    const violations: AdReviewViolation[] = [];

    // Check prohibited content patterns in text
    this.checkProhibitedContent(asset.textContent, violations);

    // Check text-to-image ratio
    this.checkTextRatio(asset, violations);

    // Check landing page consistency
    this.checkLandingPage(asset, violations);

    return {
      assetId: asset.id,
      passed: violations.filter((v) => v.severity === "error").length === 0,
      violations,
      checkedAt: new Date().toISOString(),
    };
  }

  private checkProhibitedContent(text: string, violations: AdReviewViolation[]): void {
    for (const rule of PROHIBITED_PATTERNS) {
      if (rule.pattern.test(text)) {
        violations.push({
          code: rule.code,
          severity: "error",
          message: rule.message,
        });
      }
    }
  }

  private checkTextRatio(asset: CreativeAssetForReview, violations: AdReviewViolation[]): void {
    if (asset.type !== "image" && asset.type !== "carousel") return;
    if (asset.textToImageRatio === undefined) return;

    if (asset.textToImageRatio > MAX_TEXT_TO_IMAGE_RATIO) {
      violations.push({
        code: "TEXT_RATIO_EXCEEDED",
        severity: "warning",
        message: `Text-to-image ratio ${(asset.textToImageRatio * 100).toFixed(0)}% exceeds recommended ${MAX_TEXT_TO_IMAGE_RATIO * 100}% maximum`,
      });
    }
  }

  private checkLandingPage(asset: CreativeAssetForReview, violations: AdReviewViolation[]): void {
    if (!asset.landingPageUrl) return;

    // Basic URL validation
    try {
      const url = new URL(asset.landingPageUrl);
      if (url.protocol !== "https:") {
        violations.push({
          code: "LANDING_PAGE_NOT_HTTPS",
          severity: "error",
          message: "Landing page must use HTTPS",
        });
      }
    } catch {
      violations.push({
        code: "LANDING_PAGE_INVALID_URL",
        severity: "error",
        message: `Invalid landing page URL: ${asset.landingPageUrl}`,
      });
    }
  }
}
