// ---------------------------------------------------------------------------
// Creative Asset Handler — Store and select images for ad campaigns
// ---------------------------------------------------------------------------
// Manages business-provided creative assets (images/videos) and selects
// appropriate assets for each campaign based on the service being promoted.
//
// For v1: images are provided by the business during onboarding or via
// Telegram. AI selects appropriate images based on tags and service match.
// Image generation via AI is deferred to v2.
// ---------------------------------------------------------------------------

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreativeAsset {
  id: string;
  organizationId: string;
  /** Original filename */
  fileName: string;
  /** MIME type (image/jpeg, image/png, video/mp4) */
  mimeType: string;
  /** Storage URL or path */
  url: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Width in pixels (images/video) */
  width?: number;
  /** Height in pixels (images/video) */
  height?: number;
  /** User-provided or auto-detected tags for matching */
  tags: string[];
  /** Which services this asset is associated with */
  serviceIds: string[];
  /** Asset type */
  type: "image" | "video";
  /** Upload source */
  source: "onboarding" | "telegram" | "dashboard" | "api";
  /** Whether this asset is approved for use in ads */
  approved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssetSelectionCriteria {
  serviceId?: string;
  tags?: string[];
  type?: "image" | "video";
  minWidth?: number;
  minHeight?: number;
  /** Preferred aspect ratio (e.g. "1:1", "9:16", "16:9") */
  aspectRatio?: string;
}

export interface AssetMatch {
  asset: CreativeAsset;
  /** Relevance score 0-100 */
  score: number;
  matchReasons: string[];
}

// ── Asset Registry ──────────────────────────────────────────────────────────

export class CreativeAssetRegistry {
  private assets: Map<string, CreativeAsset> = new Map();

  /**
   * Register a new creative asset.
   */
  add(asset: CreativeAsset): void {
    this.assets.set(asset.id, asset);
  }

  /**
   * Remove an asset by ID.
   */
  remove(assetId: string): boolean {
    return this.assets.delete(assetId);
  }

  /**
   * Get an asset by ID.
   */
  get(assetId: string): CreativeAsset | undefined {
    return this.assets.get(assetId);
  }

  /**
   * List all assets for an organization.
   */
  listByOrganization(organizationId: string): CreativeAsset[] {
    return Array.from(this.assets.values()).filter((a) => a.organizationId === organizationId);
  }

  /**
   * Select the best matching assets for a campaign.
   *
   * Scoring:
   * - Service match: +40 points
   * - Tag match: +10 points per matching tag
   * - Type match: +20 points
   * - Size/resolution match: +10 points
   * - Aspect ratio match: +20 points
   *
   * Returns sorted by score (highest first), limited to `maxResults`.
   */
  selectForCampaign(
    organizationId: string,
    criteria: AssetSelectionCriteria,
    maxResults = 5,
  ): AssetMatch[] {
    const orgAssets = this.listByOrganization(organizationId).filter((a) => a.approved);

    const matches: AssetMatch[] = [];

    for (const asset of orgAssets) {
      let score = 0;
      const reasons: string[] = [];

      // Service match
      if (criteria.serviceId && asset.serviceIds.includes(criteria.serviceId)) {
        score += 40;
        reasons.push(`Matched service: ${criteria.serviceId}`);
      }

      // Tag match
      if (criteria.tags) {
        const matchedTags = criteria.tags.filter((t) =>
          asset.tags.some((at) => at.toLowerCase() === t.toLowerCase()),
        );
        if (matchedTags.length > 0) {
          score += matchedTags.length * 10;
          reasons.push(`Matched tags: ${matchedTags.join(", ")}`);
        }
      }

      // Type match
      if (criteria.type) {
        if (asset.type === criteria.type) {
          score += 20;
          reasons.push(`Matched type: ${criteria.type}`);
        }
      } else {
        // Default preference for images
        if (asset.type === "image") {
          score += 10;
        }
      }

      // Resolution check
      if (criteria.minWidth && asset.width && asset.width >= criteria.minWidth) {
        score += 5;
        reasons.push("Meets minimum width");
      }
      if (criteria.minHeight && asset.height && asset.height >= criteria.minHeight) {
        score += 5;
        reasons.push("Meets minimum height");
      }

      // Aspect ratio match
      if (criteria.aspectRatio && asset.width && asset.height) {
        const assetRatio = this.getAspectRatioLabel(asset.width, asset.height);
        if (assetRatio === criteria.aspectRatio) {
          score += 20;
          reasons.push(`Matched aspect ratio: ${criteria.aspectRatio}`);
        }
      }

      // Only include assets with some relevance (or all if no criteria specified)
      if (score > 0 || (!criteria.serviceId && !criteria.tags)) {
        matches.push({ asset, score, matchReasons: reasons });
      }
    }

    return matches.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  /**
   * Get asset counts by type for an organization.
   */
  getAssetCounts(organizationId: string): { images: number; videos: number; total: number } {
    const assets = this.listByOrganization(organizationId);
    const images = assets.filter((a) => a.type === "image").length;
    const videos = assets.filter((a) => a.type === "video").length;
    return { images, videos, total: assets.length };
  }

  /**
   * Get approximate aspect ratio label from dimensions.
   */
  private getAspectRatioLabel(width: number, height: number): string {
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.05) return "1:1";
    if (Math.abs(ratio - 16 / 9) < 0.1) return "16:9";
    if (Math.abs(ratio - 9 / 16) < 0.1) return "9:16";
    if (Math.abs(ratio - 4 / 5) < 0.1) return "4:5";
    if (Math.abs(ratio - 4 / 3) < 0.1) return "4:3";
    return `${width}:${height}`;
  }
}
