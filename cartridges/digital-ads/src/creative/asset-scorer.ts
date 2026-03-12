/* eslint-disable max-lines */
// ---------------------------------------------------------------------------
// Creative Asset Scorer — Visual asset analysis + performance scoring
// ---------------------------------------------------------------------------
// Bridges the creative intelligence gap by combining pre-computed vision model
// outputs with performance data to produce actionable creative recommendations.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssetType = "image" | "video" | "carousel" | "collection";

export interface VisualAttributes {
  /** Pre-computed by vision model (values 0-1) */
  hasText: boolean;
  textCoverage: number;
  hasFaces: boolean;
  faceCount: number;
  hasProduct: boolean;
  productProminence: number;
  hasBranding: boolean;
  brandingProminence: number;
  colorDominant: string;
  colorVibrancy: number;
  colorContrast: number;
  complexity: number;
  /** Video-specific */
  videoDurationSec?: number;
  hasHookIn3Sec?: boolean;
  hasCaptionsOrSubtitles?: boolean;
  sceneChangeCount?: number;
  averageShotDurationSec?: number;
}

export interface AssetPerformanceData {
  adId: string;
  adName: string;
  assetType: AssetType;
  thumbnailUrl?: string;
  /** Performance metrics */
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  ctr: number;
  cpa: number | null;
  frequency: number;
  /** Video metrics (if applicable) */
  videoPlays?: number;
  videoP25?: number;
  videoP50?: number;
  videoP75?: number;
  videoP100?: number;
  avgWatchTimeSec?: number;
  thumbstopRate?: number;
}

export interface AssetScore {
  adId: string;
  adName: string;
  assetType: AssetType;
  /** Individual dimension scores (0-100) */
  scores: {
    performanceScore: number;
    engagementScore: number;
    creativeQualityScore: number;
    fatigueScore: number;
    formatScore: number;
  };
  /** Overall composite score (0-100) */
  overallScore: number;
  /** Letter grade */
  grade: "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";
  /** Specific strengths and weaknesses */
  strengths: string[];
  weaknesses: string[];
  /** Actionable recommendations */
  recommendations: string[];
}

export interface AssetAnalysisResult {
  accountId: string;
  analyzedAt: string;
  totalAssetsAnalyzed: number;
  assets: AssetScore[];
  /** Aggregate insights */
  insights: {
    avgOverallScore: number;
    scoreDistribution: Record<string, number>;
    topPerformingAttributes: string[];
    underperformingPatterns: string[];
    formatMixRecommendation: string;
    diversityScore: number;
  };
  recommendations: string[];
}

export interface CreativeBrief {
  recommendedFormats: Array<{ format: AssetType; reason: string }>;
  visualGuidelines: string[];
  copyGuidelines: string[];
  ctaRecommendations: string[];
  avoidList: string[];
  exampleReferences: Array<{ adId: string; adName: string; why: string }>;
}

// ---------------------------------------------------------------------------
// Scoring weights
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS = {
  performance: 0.35,
  engagement: 0.25,
  quality: 0.2,
  fatigue: 0.1,
  format: 0.1,
} as const;

// ---------------------------------------------------------------------------
// CreativeAssetScorer
// ---------------------------------------------------------------------------

export class CreativeAssetScorer {
  // -----------------------------------------------------------------------
  // scoreAsset — Compute per-asset score
  // -----------------------------------------------------------------------

  scoreAsset(
    asset: AssetPerformanceData,
    visualAttrs: VisualAttributes | null,
    peerMetrics: { avgCPA: number; avgCTR: number; avgFrequency: number },
  ): AssetScore {
    const performanceScore = this.computePerformanceScore(asset, peerMetrics);
    const engagementScore = this.computeEngagementScore(asset, peerMetrics);
    const creativeQualityScore = this.computeCreativeQualityScore(asset, visualAttrs);
    const fatigueScore = this.computeFatigueScore(asset, peerMetrics);
    const formatScore = this.computeFormatScore(asset, visualAttrs);

    const overallScore = Math.round(
      performanceScore * DIMENSION_WEIGHTS.performance +
        engagementScore * DIMENSION_WEIGHTS.engagement +
        creativeQualityScore * DIMENSION_WEIGHTS.quality +
        fatigueScore * DIMENSION_WEIGHTS.fatigue +
        formatScore * DIMENSION_WEIGHTS.format,
    );

    const grade = this.assignGrade(overallScore);
    const strengths = this.identifyStrengths(asset, visualAttrs, {
      performanceScore,
      engagementScore,
      creativeQualityScore,
      fatigueScore,
      formatScore,
    });
    const weaknesses = this.identifyWeaknesses(asset, visualAttrs, {
      performanceScore,
      engagementScore,
      creativeQualityScore,
      fatigueScore,
      formatScore,
    });
    const recommendations = this.generateRecommendations(asset, visualAttrs, {
      performanceScore,
      engagementScore,
      creativeQualityScore,
      fatigueScore,
      formatScore,
    });

    return {
      adId: asset.adId,
      adName: asset.adName,
      assetType: asset.assetType,
      scores: {
        performanceScore,
        engagementScore,
        creativeQualityScore,
        fatigueScore,
        formatScore,
      },
      overallScore,
      grade,
      strengths,
      weaknesses,
      recommendations,
    };
  }

  // -----------------------------------------------------------------------
  // analyzePortfolio — Score all assets + aggregate insights
  // -----------------------------------------------------------------------

  analyzePortfolio(
    accountId: string,
    assets: AssetPerformanceData[],
    visualAttributesMap?: Map<string, VisualAttributes>,
  ): AssetAnalysisResult {
    if (assets.length === 0) {
      return {
        accountId,
        analyzedAt: new Date().toISOString(),
        totalAssetsAnalyzed: 0,
        assets: [],
        insights: {
          avgOverallScore: 0,
          scoreDistribution: {},
          topPerformingAttributes: [],
          underperformingPatterns: [],
          formatMixRecommendation:
            "No assets to analyze — start by creating ads across multiple formats.",
          diversityScore: 0,
        },
        recommendations: ["No creative assets found. Begin by uploading image and video ads."],
      };
    }

    // Compute peer metrics from the portfolio itself
    const peerMetrics = this.computePeerMetrics(assets);

    // Score every asset
    const scoredAssets: AssetScore[] = assets.map((asset) => {
      const visualAttrs = visualAttributesMap?.get(asset.adId) ?? null;
      return this.scoreAsset(asset, visualAttrs, peerMetrics);
    });

    // Sort by overall score descending
    scoredAssets.sort((a, b) => b.overallScore - a.overallScore);

    // Aggregate insights
    const avgOverallScore = Math.round(
      scoredAssets.reduce((sum, a) => sum + a.overallScore, 0) / scoredAssets.length,
    );

    const scoreDistribution: Record<string, number> = {};
    for (const scored of scoredAssets) {
      scoreDistribution[scored.grade] = (scoreDistribution[scored.grade] ?? 0) + 1;
    }

    const topPerformingAttributes = this.correlateAttributesWithPerformance(
      assets,
      scoredAssets,
      visualAttributesMap,
    );
    const underperformingPatterns = this.identifyUnderperformingPatterns(
      assets,
      scoredAssets,
      visualAttributesMap,
    );
    const formatMixRecommendation = this.generateFormatMixRecommendation(assets, scoredAssets);
    const diversityScore = this.computeDiversityScore(assets, visualAttributesMap);

    const recommendations = this.generatePortfolioRecommendations(
      scoredAssets,
      avgOverallScore,
      diversityScore,
      topPerformingAttributes,
      underperformingPatterns,
    );

    return {
      accountId,
      analyzedAt: new Date().toISOString(),
      totalAssetsAnalyzed: assets.length,
      assets: scoredAssets,
      insights: {
        avgOverallScore,
        scoreDistribution,
        topPerformingAttributes,
        underperformingPatterns,
        formatMixRecommendation,
        diversityScore,
      },
      recommendations,
    };
  }

  // -----------------------------------------------------------------------
  // generateCreativeBrief — Produce actionable creative direction
  // -----------------------------------------------------------------------

  generateCreativeBrief(topPerformers: AssetScore[], weaknesses: string[]): CreativeBrief {
    const recommendedFormats = this.recommendFormats(topPerformers);
    const visualGuidelines = this.buildVisualGuidelines(topPerformers, weaknesses);
    const copyGuidelines = this.buildCopyGuidelines(topPerformers, weaknesses);
    const ctaRecommendations = this.buildCTARecommendations(topPerformers);
    const avoidList = this.buildAvoidList(weaknesses);
    const exampleReferences = this.buildExampleReferences(topPerformers);

    return {
      recommendedFormats,
      visualGuidelines,
      copyGuidelines,
      ctaRecommendations,
      avoidList,
      exampleReferences,
    };
  }

  // -----------------------------------------------------------------------
  // Dimension score computation (private)
  // -----------------------------------------------------------------------

  private computePerformanceScore(
    asset: AssetPerformanceData,
    peerMetrics: { avgCPA: number; avgCTR: number },
  ): number {
    let score = 50; // baseline

    // CPA comparison (lower is better)
    if (asset.cpa !== null && peerMetrics.avgCPA > 0) {
      const cpaRatio = asset.cpa / peerMetrics.avgCPA;
      if (cpaRatio <= 0.5) score += 40;
      else if (cpaRatio <= 0.75) score += 30;
      else if (cpaRatio <= 1.0) score += 15;
      else if (cpaRatio <= 1.5) score -= 10;
      else if (cpaRatio <= 2.0) score -= 25;
      else score -= 40;
    } else if (asset.conversions === 0 && asset.spend > 0) {
      // Spent money with zero conversions
      score -= 30;
    }

    // Weight by conversion volume — more conversions = more confidence
    if (asset.conversions >= 50) score += 10;
    else if (asset.conversions >= 20) score += 5;
    else if (asset.conversions < 5 && asset.conversions > 0) score -= 5;

    return clamp(score, 0, 100);
  }

  private computeEngagementScore(
    asset: AssetPerformanceData,
    peerMetrics: { avgCTR: number },
  ): number {
    let score = 50;

    // CTR comparison
    if (peerMetrics.avgCTR > 0) {
      const ctrRatio = asset.ctr / peerMetrics.avgCTR;
      if (ctrRatio >= 2.0) score += 35;
      else if (ctrRatio >= 1.5) score += 25;
      else if (ctrRatio >= 1.0) score += 10;
      else if (ctrRatio >= 0.75) score -= 5;
      else if (ctrRatio >= 0.5) score -= 15;
      else score -= 30;
    }

    // Video-specific engagement signals
    if (asset.assetType === "video") {
      // Thumbstop rate (3-sec view rate)
      if (asset.thumbstopRate !== undefined) {
        if (asset.thumbstopRate >= 0.3) score += 10;
        else if (asset.thumbstopRate >= 0.2) score += 5;
        else if (asset.thumbstopRate < 0.1) score -= 10;
      }

      // Video retention curve
      if (asset.videoP25 !== undefined && asset.videoP50 !== undefined) {
        const retentionDrop =
          (asset.videoP25 - (asset.videoP50 ?? 0)) / Math.max(asset.videoP25, 1);
        if (retentionDrop < 0.3)
          score += 10; // good retention
        else if (retentionDrop > 0.6) score -= 10; // heavy drop-off
      }

      // Completion rate
      if (asset.videoP100 !== undefined && asset.videoPlays !== undefined && asset.videoPlays > 0) {
        const completionRate = asset.videoP100 / asset.videoPlays;
        if (completionRate >= 0.15) score += 5;
        else if (completionRate < 0.05) score -= 5;
      }
    }

    return clamp(score, 0, 100);
  }

  private computeCreativeQualityScore(
    _asset: AssetPerformanceData,
    visualAttrs: VisualAttributes | null,
  ): number {
    if (!visualAttrs) return 50; // no visual data — return neutral

    let score = 50;

    // Faces present — generally boosts engagement
    if (visualAttrs.hasFaces) {
      score += 8;
      if (visualAttrs.faceCount >= 1 && visualAttrs.faceCount <= 3) score += 4;
    }

    // Product prominence
    if (visualAttrs.hasProduct) {
      if (visualAttrs.productProminence >= 0.5) score += 10;
      else if (visualAttrs.productProminence >= 0.3) score += 5;
    } else {
      score -= 10; // no product visible
    }

    // Text coverage — moderate is ideal (10-30%)
    if (visualAttrs.hasText) {
      if (visualAttrs.textCoverage >= 0.1 && visualAttrs.textCoverage <= 0.3) {
        score += 8; // ideal text coverage
      } else if (visualAttrs.textCoverage > 0.4) {
        score -= 15; // too much text — Facebook also penalizes this
      } else if (visualAttrs.textCoverage > 0.3) {
        score -= 5; // slightly heavy
      }
    }

    // Color contrast
    if (visualAttrs.colorContrast >= 0.6) score += 5;
    else if (visualAttrs.colorContrast < 0.3) score -= 5;

    // Color vibrancy
    if (visualAttrs.colorVibrancy >= 0.5) score += 3;

    // Branding
    if (visualAttrs.hasBranding) {
      if (visualAttrs.brandingProminence >= 0.2 && visualAttrs.brandingProminence <= 0.5) {
        score += 5; // subtle but present
      } else if (visualAttrs.brandingProminence > 0.7) {
        score -= 3; // overly branded
      }
    }

    // Complexity — moderate is best
    if (visualAttrs.complexity > 0.8) {
      score -= 10; // too busy
    } else if (visualAttrs.complexity >= 0.3 && visualAttrs.complexity <= 0.6) {
      score += 5; // good visual balance
    }

    return clamp(score, 0, 100);
  }

  private computeFatigueScore(
    asset: AssetPerformanceData,
    peerMetrics: { avgFrequency: number },
  ): number {
    // Higher frequency = more fatigue = lower score (inverse)
    let score = 100;

    if (asset.frequency >= 6) score = 10;
    else if (asset.frequency >= 5) score = 25;
    else if (asset.frequency >= 4) score = 40;
    else if (asset.frequency >= 3) score = 55;
    else if (asset.frequency >= 2) score = 70;
    else if (asset.frequency >= 1.5) score = 85;

    // Additional penalty if frequency is much higher than peers
    if (peerMetrics.avgFrequency > 0) {
      const freqRatio = asset.frequency / peerMetrics.avgFrequency;
      if (freqRatio >= 2.0) score -= 15;
      else if (freqRatio >= 1.5) score -= 8;
    }

    return clamp(score, 0, 100);
  }

  private computeFormatScore(
    asset: AssetPerformanceData,
    visualAttrs: VisualAttributes | null,
  ): number {
    let score = 60; // baseline — most formats are acceptable

    switch (asset.assetType) {
      case "video": {
        // Video best practices
        if (visualAttrs) {
          // Hook in first 3 seconds
          if (visualAttrs.hasHookIn3Sec === true) score += 15;
          else if (visualAttrs.hasHookIn3Sec === false) score -= 10;

          // Captions/subtitles (85%+ watch without sound)
          if (visualAttrs.hasCaptionsOrSubtitles === true) score += 10;
          else if (visualAttrs.hasCaptionsOrSubtitles === false) score -= 8;

          // Optimal duration: 15-30 seconds for most ads
          if (visualAttrs.videoDurationSec !== undefined) {
            if (visualAttrs.videoDurationSec >= 6 && visualAttrs.videoDurationSec <= 30) {
              score += 10;
            } else if (visualAttrs.videoDurationSec > 60) {
              score -= 10;
            } else if (visualAttrs.videoDurationSec < 6) {
              score -= 5;
            }
          }

          // Scene changes — moderate pacing
          if (visualAttrs.averageShotDurationSec !== undefined) {
            if (
              visualAttrs.averageShotDurationSec >= 2 &&
              visualAttrs.averageShotDurationSec <= 5
            ) {
              score += 5; // dynamic but not chaotic
            } else if (visualAttrs.averageShotDurationSec < 1) {
              score -= 5; // too fast
            }
          }
        }
        break;
      }

      case "image": {
        // Image best practices
        if (visualAttrs) {
          if (visualAttrs.hasProduct) score += 10;
          else score -= 5;
          if (visualAttrs.colorContrast >= 0.5) score += 5;
        }
        break;
      }

      case "carousel": {
        // Carousel — reward diversity (no visual attrs needed for this heuristic)
        score += 5; // carousels generally perform well for engagement
        break;
      }

      case "collection": {
        // Collection ads — reward for commerce
        score += 5;
        break;
      }
    }

    return clamp(score, 0, 100);
  }

  // -----------------------------------------------------------------------
  // Grading
  // -----------------------------------------------------------------------

  private assignGrade(score: number): "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F" {
    if (score >= 93) return "A+";
    if (score >= 85) return "A";
    if (score >= 78) return "B+";
    if (score >= 70) return "B";
    if (score >= 63) return "C+";
    if (score >= 55) return "C";
    if (score >= 40) return "D";
    return "F";
  }

  // -----------------------------------------------------------------------
  // Strengths / Weaknesses / Recommendations per asset
  // -----------------------------------------------------------------------

  private identifyStrengths(
    asset: AssetPerformanceData,
    visualAttrs: VisualAttributes | null,
    scores: Record<string, number>,
  ): string[] {
    const strengths: string[] = [];

    if ((scores.performanceScore ?? 0) >= 75) {
      strengths.push("Strong conversion performance relative to peers");
    }
    if ((scores.engagementScore ?? 0) >= 75) {
      strengths.push("Above-average engagement rate");
    }
    if ((scores.fatigueScore ?? 0) >= 80) {
      strengths.push("Low creative fatigue — still fresh");
    }
    if ((scores.formatScore ?? 0) >= 75) {
      strengths.push("Good format best-practice adherence");
    }

    if (visualAttrs) {
      if (visualAttrs.hasFaces && visualAttrs.faceCount >= 1) {
        strengths.push("Includes human faces, which tend to boost engagement");
      }
      if (visualAttrs.hasProduct && visualAttrs.productProminence >= 0.5) {
        strengths.push("Product is prominently displayed");
      }
      if (visualAttrs.colorContrast >= 0.6) {
        strengths.push("High color contrast helps stand out in the feed");
      }
      if (
        visualAttrs.hasText &&
        visualAttrs.textCoverage >= 0.1 &&
        visualAttrs.textCoverage <= 0.3
      ) {
        strengths.push("Optimal text coverage (10-30%)");
      }
      if (asset.assetType === "video") {
        if (visualAttrs.hasHookIn3Sec) {
          strengths.push("Strong hook in first 3 seconds");
        }
        if (visualAttrs.hasCaptionsOrSubtitles) {
          strengths.push("Includes captions/subtitles for sound-off viewing");
        }
      }
    }

    if (
      asset.assetType === "video" &&
      asset.thumbstopRate !== undefined &&
      asset.thumbstopRate >= 0.25
    ) {
      strengths.push(`Strong thumbstop rate (${(asset.thumbstopRate * 100).toFixed(1)}%)`);
    }

    return strengths;
  }

  private identifyWeaknesses(
    asset: AssetPerformanceData,
    visualAttrs: VisualAttributes | null,
    scores: Record<string, number>,
  ): string[] {
    const weaknesses: string[] = [];

    if ((scores.performanceScore ?? 0) < 40) {
      weaknesses.push("Conversion performance significantly below peers");
    }
    if ((scores.engagementScore ?? 0) < 40) {
      weaknesses.push("Low engagement rate — creative may not be compelling");
    }
    if ((scores.fatigueScore ?? 0) < 40) {
      weaknesses.push("High creative fatigue — audience has seen this too many times");
    }
    if ((scores.formatScore ?? 0) < 40) {
      weaknesses.push("Format does not follow platform best practices");
    }

    if (visualAttrs) {
      if (visualAttrs.textCoverage > 0.4) {
        weaknesses.push("Excessive text overlay (>40%) — may reduce delivery and engagement");
      }
      if (!visualAttrs.hasProduct) {
        weaknesses.push("No product visible in the creative");
      }
      if (visualAttrs.complexity > 0.8) {
        weaknesses.push("Visually too complex/busy — simplify the composition");
      }
      if (visualAttrs.colorContrast < 0.3) {
        weaknesses.push("Low color contrast — may blend into the feed");
      }
      if (asset.assetType === "video") {
        if (visualAttrs.hasHookIn3Sec === false) {
          weaknesses.push("No attention-grabbing hook in the first 3 seconds");
        }
        if (visualAttrs.hasCaptionsOrSubtitles === false) {
          weaknesses.push("Missing captions — 85%+ of video ads are watched without sound");
        }
        if (visualAttrs.videoDurationSec !== undefined && visualAttrs.videoDurationSec > 60) {
          weaknesses.push("Video too long (>60s) — consider a shorter edit");
        }
      }
    }

    if (asset.conversions === 0 && asset.spend > 50) {
      weaknesses.push("No conversions despite significant spend");
    }

    return weaknesses;
  }

  private generateRecommendations(
    asset: AssetPerformanceData,
    visualAttrs: VisualAttributes | null,
    scores: Record<string, number>,
  ): string[] {
    const recs: string[] = [];

    if ((scores.fatigueScore ?? 0) < 40) {
      recs.push("Refresh this creative with a new angle or visual to combat fatigue");
    }

    if ((scores.performanceScore ?? 0) < 50 && (scores.engagementScore ?? 0) >= 60) {
      recs.push(
        "Good engagement but poor conversion — review landing page alignment and CTA clarity",
      );
    }

    if ((scores.engagementScore ?? 0) < 40) {
      recs.push("Test a more compelling hook or visual to improve engagement");
    }

    if (visualAttrs) {
      if (visualAttrs.textCoverage > 0.4) {
        recs.push("Reduce text overlay to under 20% for better platform performance");
      }
      if (!visualAttrs.hasProduct) {
        recs.push("Add a clear product shot to improve purchase intent");
      }
      if (visualAttrs.colorContrast < 0.3) {
        recs.push("Increase color contrast to stand out in the feed");
      }
      if (asset.assetType === "video" && visualAttrs.hasCaptionsOrSubtitles === false) {
        recs.push("Add captions to improve accessibility and sound-off viewing");
      }
      if (asset.assetType === "video" && visualAttrs.hasHookIn3Sec === false) {
        recs.push("Add an attention-grabbing element in the first 3 seconds");
      }
      if (visualAttrs.complexity > 0.8) {
        recs.push("Simplify the visual composition — focus on one key element");
      }
    }

    if (
      asset.assetType === "image" &&
      scores.overallScore !== undefined &&
      (scores.engagementScore ?? 0) < 50
    ) {
      recs.push("Consider testing a video version of this creative for higher engagement");
    }

    return recs;
  }

  // -----------------------------------------------------------------------
  // Portfolio-level analysis helpers (private)
  // -----------------------------------------------------------------------

  private computePeerMetrics(assets: AssetPerformanceData[]): {
    avgCPA: number;
    avgCTR: number;
    avgFrequency: number;
  } {
    const withConversions = assets.filter((a) => a.conversions > 0);
    const totalSpend = withConversions.reduce((s, a) => s + a.spend, 0);
    const totalConversions = withConversions.reduce((s, a) => s + a.conversions, 0);
    const avgCPA = totalConversions > 0 ? totalSpend / totalConversions : 0;

    const totalImpressions = assets.reduce((s, a) => s + a.impressions, 0);
    const totalClicks = assets.reduce((s, a) => s + a.clicks, 0);
    const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    const avgFrequency =
      assets.length > 0 ? assets.reduce((s, a) => s + a.frequency, 0) / assets.length : 1;

    return { avgCPA, avgCTR, avgFrequency };
  }

  private correlateAttributesWithPerformance(
    _assets: AssetPerformanceData[],
    scoredAssets: AssetScore[],
    visualAttributesMap?: Map<string, VisualAttributes>,
  ): string[] {
    if (!visualAttributesMap || visualAttributesMap.size === 0) {
      return [
        "Visual attribute data not available — provide vision model outputs for deeper insights",
      ];
    }

    const topN = Math.max(1, Math.ceil(scoredAssets.length * 0.25));
    const bottomN = Math.max(1, Math.ceil(scoredAssets.length * 0.25));
    const topIds = new Set(scoredAssets.slice(0, topN).map((a) => a.adId));
    const bottomIds = new Set(scoredAssets.slice(-bottomN).map((a) => a.adId));

    const attributes: string[] = [];

    // Tally attribute prevalence in top vs bottom performers
    const topAttrs = this.tallyAttributes(topIds, visualAttributesMap);
    const bottomAttrs = this.tallyAttributes(bottomIds, visualAttributesMap);

    if (topAttrs.faceRate > bottomAttrs.faceRate + 0.2) {
      attributes.push("Creatives with human faces correlate with higher performance");
    }
    if (topAttrs.productRate > bottomAttrs.productRate + 0.2) {
      attributes.push("Prominent product shots correlate with better results");
    }
    if (topAttrs.avgContrast > bottomAttrs.avgContrast + 0.15) {
      attributes.push("Higher color contrast correlates with better performance");
    }
    if (topAttrs.avgTextCoverage < bottomAttrs.avgTextCoverage - 0.1) {
      attributes.push("Less text overlay correlates with better performance");
    }
    if (topAttrs.captionRate > bottomAttrs.captionRate + 0.2) {
      attributes.push("Videos with captions outperform those without");
    }
    if (topAttrs.hookRate > bottomAttrs.hookRate + 0.2) {
      attributes.push("Videos with a strong first-3-second hook outperform those without");
    }
    if (topAttrs.brandingRate > bottomAttrs.brandingRate + 0.2) {
      attributes.push("Subtle branding presence correlates with better performance");
    }

    if (attributes.length === 0) {
      attributes.push(
        "No single visual attribute strongly differentiates top from bottom performers — test multiple creative angles",
      );
    }

    return attributes;
  }

  private tallyAttributes(
    adIds: Set<string>,
    visualAttributesMap: Map<string, VisualAttributes>,
  ): {
    faceRate: number;
    productRate: number;
    avgContrast: number;
    avgTextCoverage: number;
    captionRate: number;
    hookRate: number;
    brandingRate: number;
  } {
    let count = 0;
    let faces = 0;
    let products = 0;
    let contrastSum = 0;
    let textCoverageSum = 0;
    let captions = 0;
    let hooks = 0;
    let branding = 0;
    let videoCount = 0;

    for (const adId of adIds) {
      const attrs = visualAttributesMap.get(adId);
      if (!attrs) continue;
      count++;
      if (attrs.hasFaces) faces++;
      if (attrs.hasProduct) products++;
      contrastSum += attrs.colorContrast;
      textCoverageSum += attrs.textCoverage;
      if (attrs.hasBranding) branding++;
      if (attrs.hasCaptionsOrSubtitles !== undefined) {
        videoCount++;
        if (attrs.hasCaptionsOrSubtitles) captions++;
        if (attrs.hasHookIn3Sec) hooks++;
      }
    }

    const safe = Math.max(count, 1);
    const safeVideo = Math.max(videoCount, 1);

    return {
      faceRate: faces / safe,
      productRate: products / safe,
      avgContrast: contrastSum / safe,
      avgTextCoverage: textCoverageSum / safe,
      captionRate: captions / safeVideo,
      hookRate: hooks / safeVideo,
      brandingRate: branding / safe,
    };
  }

  private identifyUnderperformingPatterns(
    _assets: AssetPerformanceData[],
    scoredAssets: AssetScore[],
    visualAttributesMap?: Map<string, VisualAttributes>,
  ): string[] {
    const patterns: string[] = [];
    const bottomN = Math.max(1, Math.ceil(scoredAssets.length * 0.25));
    const bottomPerformers = scoredAssets.slice(-bottomN);

    // Check format concentration in underperformers
    const formatCounts = new Map<string, number>();
    for (const bp of bottomPerformers) {
      formatCounts.set(bp.assetType, (formatCounts.get(bp.assetType) ?? 0) + 1);
    }
    for (const [format, count] of formatCounts) {
      if (count / bottomN >= 0.6 && bottomN >= 3) {
        patterns.push(
          `${format} ads are overrepresented among underperformers (${count}/${bottomN})`,
        );
      }
    }

    // Collect common weaknesses
    const weaknessCounts = new Map<string, number>();
    for (const bp of bottomPerformers) {
      for (const w of bp.weaknesses) {
        weaknessCounts.set(w, (weaknessCounts.get(w) ?? 0) + 1);
      }
    }
    for (const [weakness, count] of weaknessCounts) {
      if (count >= Math.max(2, bottomN * 0.5)) {
        patterns.push(weakness);
      }
    }

    // Check visual attributes of underperformers
    if (visualAttributesMap && visualAttributesMap.size > 0) {
      const bottomIds = new Set(bottomPerformers.map((b) => b.adId));
      const bottomAttrs = this.tallyAttributes(bottomIds, visualAttributesMap);
      if (bottomAttrs.avgTextCoverage > 0.35) {
        patterns.push("Underperformers tend to have excessive text overlay");
      }
      if (bottomAttrs.avgContrast < 0.3) {
        patterns.push("Underperformers tend to have low color contrast");
      }
    }

    if (patterns.length === 0) {
      patterns.push("No strong patterns identified among underperformers");
    }

    return patterns;
  }

  private generateFormatMixRecommendation(
    _assets: AssetPerformanceData[],
    scoredAssets: AssetScore[],
  ): string {
    const formatPerf = new Map<AssetType, { count: number; totalScore: number }>();
    for (const scored of scoredAssets) {
      const existing = formatPerf.get(scored.assetType) ?? { count: 0, totalScore: 0 };
      existing.count++;
      existing.totalScore += scored.overallScore;
      formatPerf.set(scored.assetType, existing);
    }

    const formatAvgs: Array<{ format: AssetType; avgScore: number; count: number }> = [];
    for (const [format, perf] of formatPerf) {
      formatAvgs.push({ format, avgScore: perf.totalScore / perf.count, count: perf.count });
    }
    formatAvgs.sort((a, b) => b.avgScore - a.avgScore);

    const uniqueFormats = formatAvgs.length;
    const parts: string[] = [];

    if (uniqueFormats === 1) {
      parts.push(
        `Only ${formatAvgs[0]!.format} ads in use. Diversify by testing video, carousel, and collection formats.`,
      );
    } else {
      const best = formatAvgs[0]!;
      parts.push(
        `${best.format} ads have the highest average score (${Math.round(best.avgScore)}). `,
      );
      if (uniqueFormats < 3) {
        parts.push("Add more format types to improve creative diversity.");
      } else {
        parts.push("Good format diversity — continue testing across formats.");
      }
    }

    return parts.join("");
  }

  private computeDiversityScore(
    assets: AssetPerformanceData[],
    visualAttributesMap?: Map<string, VisualAttributes>,
  ): number {
    if (assets.length === 0) return 0;

    let score = 0;

    // Format diversity (0-40 points)
    const formatSet = new Set(assets.map((a) => a.assetType));
    const formatDiversity = Math.min(formatSet.size / 4, 1); // 4 possible formats
    score += Math.round(formatDiversity * 40);

    // Count diversity (0-20 points) — at least 5 assets for a healthy mix
    const countScore = Math.min(assets.length / 5, 1);
    score += Math.round(countScore * 20);

    // Visual style diversity (0-40 points)
    if (visualAttributesMap && visualAttributesMap.size > 0) {
      let styleVariance = 0;
      const colors = new Set<string>();
      let withFaces = 0;
      let withoutFaces = 0;

      for (const [, attrs] of visualAttributesMap) {
        colors.add(attrs.colorDominant);
        if (attrs.hasFaces) withFaces++;
        else withoutFaces++;
      }

      // Color diversity
      const colorDiversity = Math.min(colors.size / Math.max(visualAttributesMap.size * 0.5, 1), 1);
      styleVariance += colorDiversity * 20;

      // Face vs no-face variety
      const total = withFaces + withoutFaces;
      if (total > 0) {
        const faceBalance = 1 - Math.abs(withFaces / total - 0.5) * 2; // 1.0 at 50/50
        styleVariance += faceBalance * 20;
      }

      score += Math.round(styleVariance);
    } else {
      // Without visual data, give partial credit
      score += 20;
    }

    return clamp(score, 0, 100);
  }

  private generatePortfolioRecommendations(
    scoredAssets: AssetScore[],
    avgOverallScore: number,
    diversityScore: number,
    topAttributes: string[],
    _underperformingPatterns: string[],
  ): string[] {
    const recs: string[] = [];

    // Overall quality
    if (avgOverallScore < 50) {
      recs.push(
        "Average creative score is below 50 — significant creative refresh needed across the portfolio",
      );
    } else if (avgOverallScore < 65) {
      recs.push(
        "Creative portfolio is average — focus on iterating on your top performers and replacing underperformers",
      );
    }

    // Diversity
    if (diversityScore < 40) {
      recs.push(
        "Low creative diversity — test different formats, visual styles, and messaging angles to find new winners",
      );
    }

    // Grade distribution
    const fCount = scoredAssets.filter((a) => a.grade === "F").length;
    const dCount = scoredAssets.filter((a) => a.grade === "D").length;
    const poorCount = fCount + dCount;
    if (poorCount > 0 && poorCount / scoredAssets.length > 0.3) {
      recs.push(
        `${poorCount} creative(s) graded D or F — consider pausing these and redirecting budget to top performers`,
      );
    }

    // Fatigue
    const fatiguedCount = scoredAssets.filter((a) => a.scores.fatigueScore < 40).length;
    if (fatiguedCount > 0) {
      recs.push(
        `${fatiguedCount} creative(s) showing significant fatigue — prepare replacement creatives`,
      );
    }

    // Leverage top attributes
    for (const attr of topAttributes) {
      if (!attr.includes("not available") && !attr.includes("No single")) {
        recs.push(`Lean into: ${attr}`);
      }
    }

    return recs;
  }

  // -----------------------------------------------------------------------
  // Creative brief helpers (private)
  // -----------------------------------------------------------------------

  private recommendFormats(
    topPerformers: AssetScore[],
  ): Array<{ format: AssetType; reason: string }> {
    const formatScores = new Map<AssetType, { totalScore: number; count: number }>();
    for (const tp of topPerformers) {
      const existing = formatScores.get(tp.assetType) ?? { totalScore: 0, count: 0 };
      existing.totalScore += tp.overallScore;
      existing.count++;
      formatScores.set(tp.assetType, existing);
    }

    const result: Array<{ format: AssetType; reason: string }> = [];
    for (const [format, data] of formatScores) {
      const avg = Math.round(data.totalScore / data.count);
      result.push({
        format,
        reason: `${data.count} top performer(s) use this format with an average score of ${avg}`,
      });
    }

    // Always recommend video if not already present
    if (!formatScores.has("video")) {
      result.push({
        format: "video",
        reason:
          "Video is not yet in your top performers — test short-form video (15-30s) with captions",
      });
    }

    return result;
  }

  private buildVisualGuidelines(topPerformers: AssetScore[], weaknesses: string[]): string[] {
    const guidelines: string[] = [];

    // Derive from top performer strengths
    const strengthCounts = new Map<string, number>();
    for (const tp of topPerformers) {
      for (const s of tp.strengths) {
        strengthCounts.set(s, (strengthCounts.get(s) ?? 0) + 1);
      }
    }

    if (strengthCounts.has("Product is prominently displayed")) {
      guidelines.push("Feature the product prominently in the hero visual");
    }
    if (strengthCounts.has("Includes human faces, which tend to boost engagement")) {
      guidelines.push(
        "Include authentic human faces — lifestyle imagery outperforms product-only shots",
      );
    }
    if (strengthCounts.has("High color contrast helps stand out in the feed")) {
      guidelines.push("Use high-contrast colors to stand out in the feed");
    }

    // Derive from weaknesses to avoid
    if (weaknesses.some((w) => w.includes("text"))) {
      guidelines.push("Keep text overlay to 10-20% of the image — avoid covering more than 30%");
    }
    if (weaknesses.some((w) => w.includes("complex") || w.includes("busy"))) {
      guidelines.push("Keep visuals clean with a single focal point");
    }

    // Universal best practices
    guidelines.push("Use a 1:1 or 4:5 aspect ratio for mobile-first feed placement");

    return guidelines;
  }

  private buildCopyGuidelines(_topPerformers: AssetScore[], weaknesses: string[]): string[] {
    const guidelines: string[] = [];

    guidelines.push("Lead with the value proposition in the first line");
    guidelines.push("Keep primary text under 125 characters for maximum visibility");

    if (weaknesses.some((w) => w.includes("conversion") || w.includes("CTA"))) {
      guidelines.push("Include a clear, direct CTA that matches the landing page action");
    }

    if (weaknesses.some((w) => w.includes("engagement"))) {
      guidelines.push("Test question-based or curiosity-driven headlines to boost engagement");
    }

    guidelines.push("Use social proof (numbers, testimonials) when available");

    return guidelines;
  }

  private buildCTARecommendations(topPerformers: AssetScore[]): string[] {
    const recs: string[] = [];

    const hasCommerce = topPerformers.some((tp) =>
      tp.strengths.some((s) => s.includes("product") || s.includes("Product")),
    );

    if (hasCommerce) {
      recs.push('"Shop Now" or "Buy Now" for direct-response commerce ads');
      recs.push('"Learn More" for consideration-stage ads');
    }

    recs.push("Match the CTA to the landing page action — avoid misleading CTAs");
    recs.push('Test "Get Offer" vs "Shop Now" to find the best-converting CTA');

    return recs;
  }

  private buildAvoidList(weaknesses: string[]): string[] {
    const avoid: string[] = [];

    if (weaknesses.some((w) => w.includes("text"))) {
      avoid.push("Excessive text overlay (>30% coverage)");
    }
    if (weaknesses.some((w) => w.includes("complex") || w.includes("busy"))) {
      avoid.push("Overly complex or cluttered visuals");
    }
    if (weaknesses.some((w) => w.includes("contrast"))) {
      avoid.push("Low-contrast imagery that blends into the feed");
    }
    if (weaknesses.some((w) => w.includes("caption"))) {
      avoid.push("Videos without captions or subtitles");
    }
    if (weaknesses.some((w) => w.includes("hook"))) {
      avoid.push("Videos with a slow start — hook viewers within the first 3 seconds");
    }
    if (weaknesses.some((w) => w.includes("No product"))) {
      avoid.push("Creatives with no visible product");
    }

    // Universal
    avoid.push("Stock imagery that lacks authenticity");
    avoid.push("Identical creative across all placements — tailor for Stories vs Feed");

    return avoid;
  }

  private buildExampleReferences(
    topPerformers: AssetScore[],
  ): Array<{ adId: string; adName: string; why: string }> {
    return topPerformers.slice(0, 3).map((tp) => ({
      adId: tp.adId,
      adName: tp.adName,
      why:
        tp.strengths.length > 0
          ? tp.strengths.slice(0, 2).join("; ")
          : `Overall score: ${tp.overallScore} (${tp.grade})`,
    }));
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
