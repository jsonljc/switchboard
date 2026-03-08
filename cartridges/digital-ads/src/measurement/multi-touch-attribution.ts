// ---------------------------------------------------------------------------
// Multi-Touch Attribution Engine
// ---------------------------------------------------------------------------
// Aggregate-level MTA models that work with touchpoint-level summary data.
// Since we cannot access user-level data directly, all models operate on
// aggregate conversion paths and per-channel position distributions.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttributionModel =
  | "last_click"
  | "first_click"
  | "linear"
  | "time_decay"
  | "position_based" // U-shaped: 40% first, 20% middle, 40% last
  | "data_driven"; // algorithmic based on Shapley values

export interface Touchpoint {
  channelId: string;
  channelName: string;
  platform: "meta" | "google" | "tiktok" | "organic" | "email" | "direct" | "other";
  campaignId?: string;
  /** Position in the customer journey */
  touchpointType: "impression" | "click" | "view" | "engagement";
  /** Aggregate counts */
  totalTouchpoints: number;
  /** How often this channel appears at each position */
  positionDistribution: {
    first: number; // count of times this channel was first touch
    middle: number; // count of times this channel was in the middle
    last: number; // count of times this channel was last touch
    only: number; // count of times this was the only touch
  };
  /** Spend on this channel */
  spend: number;
  /** Raw conversions attributed (last-click default) */
  lastClickConversions: number;
  lastClickRevenue: number;
}

export interface ConversionPath {
  pathId: string;
  touchpoints: string[]; // channel IDs in order
  conversions: number;
  revenue: number;
  avgDaysToConvert: number;
}

export interface MTAResult {
  model: AttributionModel;
  /** Per-channel attribution */
  channelAttribution: Array<{
    channelId: string;
    channelName: string;
    platform: string;
    /** Raw last-click numbers */
    lastClickConversions: number;
    lastClickRevenue: number;
    /** Model-attributed numbers */
    attributedConversions: number;
    attributedRevenue: number;
    /** Relative change from last-click */
    conversionDelta: number;
    conversionDeltaPercent: number;
    /** Attributed metrics */
    attributedCPA: number | null;
    attributedROAS: number | null;
    spend: number;
    /** Channel role */
    primaryRole: "introducer" | "influencer" | "closer" | "independent";
    roleScore: { introducer: number; influencer: number; closer: number };
  }>;
  /** Top conversion paths */
  topPaths: Array<{
    path: string[];
    conversions: number;
    revenue: number;
    pathLength: number;
  }>;
  /** Model comparison */
  modelComparison?: Array<{
    model: AttributionModel;
    channelId: string;
    attributedConversions: number;
  }>;
  /** Insights */
  insights: {
    avgPathLength: number;
    avgDaysToConvert: number;
    mostOvervaluedChannel: { channelId: string; overvaluation: number } | null;
    mostUndervaluedChannel: { channelId: string; undervaluation: number } | null;
    assistConversionRatio: number;
  };
  recommendations: string[];
}

export interface MTAOptions {
  /** Half-life in days for time_decay model (default: 7) */
  decayHalfLife?: number;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class MultiTouchAttributionEngine {
  /**
   * Apply the selected attribution model to touchpoints and conversion paths.
   */
  attribute(
    touchpoints: Touchpoint[],
    paths: ConversionPath[],
    model: AttributionModel,
    options?: MTAOptions,
  ): MTAResult {
    if (touchpoints.length === 0) {
      return this.emptyResult(model);
    }

    // Build channel lookup
    const channelMap = new Map<string, Touchpoint>();
    for (const tp of touchpoints) {
      channelMap.set(tp.channelId, tp);
    }

    // Attribute conversions per model
    const attributionMap = this.computeAttribution(channelMap, paths, model, options);

    // Build per-channel results
    const channelAttribution = this.buildChannelAttribution(touchpoints, attributionMap);

    // Top paths
    const topPaths = this.computeTopPaths(paths);

    // Insights
    const insights = this.computeInsights(touchpoints, paths, channelAttribution);

    // Recommendations
    const recommendations = this.generateRecommendations(channelAttribution, insights);

    return {
      model,
      channelAttribution,
      topPaths,
      insights,
      recommendations,
    };
  }

  /**
   * Run all attribution models and produce a comparison showing how each
   * model values each channel differently.
   */
  compareModels(touchpoints: Touchpoint[], paths: ConversionPath[]): MTAResult {
    const models: AttributionModel[] = [
      "last_click",
      "first_click",
      "linear",
      "time_decay",
      "position_based",
      "data_driven",
    ];

    // Run each model
    const results = new Map<AttributionModel, MTAResult>();
    for (const model of models) {
      results.set(model, this.attribute(touchpoints, paths, model));
    }

    // Use linear as the "primary" result for the comparison output
    const primaryResult = results.get("linear")!;

    // Build model comparison entries
    const modelComparison: MTAResult["modelComparison"] = [];
    for (const model of models) {
      const result = results.get(model)!;
      for (const ch of result.channelAttribution) {
        modelComparison.push({
          model,
          channelId: ch.channelId,
          attributedConversions: ch.attributedConversions,
        });
      }
    }

    // Find channels most affected by model choice
    const channelVariance = new Map<string, number>();
    for (const tp of touchpoints) {
      const vals: number[] = [];
      for (const model of models) {
        const r = results.get(model)!;
        const ch = r.channelAttribution.find((c) => c.channelId === tp.channelId);
        if (ch) vals.push(ch.attributedConversions);
      }
      if (vals.length > 1) {
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        channelVariance.set(tp.channelId, max - min);
      }
    }

    // Add to recommendations
    const recs = [...primaryResult.recommendations];
    const sortedVariance = [...channelVariance.entries()].sort((a, b) => b[1] - a[1]);
    if (sortedVariance.length > 0) {
      const [topChannelId, variance] = sortedVariance[0]!;
      const tp = channelMap(touchpoints, topChannelId);
      if (tp) {
        recs.push(
          `Channel "${tp.channelName}" is most sensitive to model choice (${variance.toFixed(1)} conversion spread). ` +
            `Consider running a lift study to validate its true incremental value.`,
        );
      }
    }

    return {
      ...primaryResult,
      model: "linear", // primary model for the comparison view
      modelComparison,
      recommendations: recs,
    };
  }

  /**
   * Analyze each channel's position distribution to determine if it's
   * primarily an introducer, influencer, or closer.
   */
  identifyChannelRoles(touchpoints: Touchpoint[]): Array<{
    channelId: string;
    channelName: string;
    role: string;
    roleScores: Record<string, number>;
  }> {
    return touchpoints.map((tp) => {
      const scores = this.computeRoleScores(tp);
      const role = this.classifyRole(tp, scores);
      return {
        channelId: tp.channelId,
        channelName: tp.channelName,
        role,
        roleScores: {
          introducer: scores.introducer,
          influencer: scores.influencer,
          closer: scores.closer,
        },
      };
    });
  }

  // -------------------------------------------------------------------------
  // Private — Attribution model implementations
  // -------------------------------------------------------------------------

  private computeAttribution(
    channelMap: Map<string, Touchpoint>,
    paths: ConversionPath[],
    model: AttributionModel,
    options?: MTAOptions,
  ): Map<string, { conversions: number; revenue: number }> {
    switch (model) {
      case "last_click":
        return this.attributeLastClick(paths);
      case "first_click":
        return this.attributeFirstClick(paths);
      case "linear":
        return this.attributeLinear(paths);
      case "time_decay":
        return this.attributeTimeDecay(paths, options?.decayHalfLife ?? 7);
      case "position_based":
        return this.attributePositionBased(paths);
      case "data_driven":
        return this.attributeDataDriven(channelMap, paths);
    }
  }

  /** last_click: 100% credit to last touchpoint in each path */
  private attributeLastClick(
    paths: ConversionPath[],
  ): Map<string, { conversions: number; revenue: number }> {
    const result = new Map<string, { conversions: number; revenue: number }>();
    for (const path of paths) {
      if (path.touchpoints.length === 0) continue;
      const lastChannel = path.touchpoints[path.touchpoints.length - 1]!;
      const existing = result.get(lastChannel) ?? { conversions: 0, revenue: 0 };
      existing.conversions += path.conversions;
      existing.revenue += path.revenue;
      result.set(lastChannel, existing);
    }
    return result;
  }

  /** first_click: 100% credit to first touchpoint in each path */
  private attributeFirstClick(
    paths: ConversionPath[],
  ): Map<string, { conversions: number; revenue: number }> {
    const result = new Map<string, { conversions: number; revenue: number }>();
    for (const path of paths) {
      if (path.touchpoints.length === 0) continue;
      const firstChannel = path.touchpoints[0]!;
      const existing = result.get(firstChannel) ?? { conversions: 0, revenue: 0 };
      existing.conversions += path.conversions;
      existing.revenue += path.revenue;
      result.set(firstChannel, existing);
    }
    return result;
  }

  /** linear: Equal credit to all touchpoints in each path */
  private attributeLinear(
    paths: ConversionPath[],
  ): Map<string, { conversions: number; revenue: number }> {
    const result = new Map<string, { conversions: number; revenue: number }>();
    for (const path of paths) {
      if (path.touchpoints.length === 0) continue;
      const creditPerTouch = 1 / path.touchpoints.length;
      for (const channelId of path.touchpoints) {
        const existing = result.get(channelId) ?? { conversions: 0, revenue: 0 };
        existing.conversions += path.conversions * creditPerTouch;
        existing.revenue += path.revenue * creditPerTouch;
        result.set(channelId, existing);
      }
    }
    return result;
  }

  /**
   * time_decay: Exponential decay from last touch backward.
   * Credit[i] = 2^(-days_before_conversion / half_life)
   *
   * Since we work with aggregate paths (not user-level timestamps), we
   * approximate position-based time as evenly spaced across avgDaysToConvert.
   */
  private attributeTimeDecay(
    paths: ConversionPath[],
    halfLife: number,
  ): Map<string, { conversions: number; revenue: number }> {
    const result = new Map<string, { conversions: number; revenue: number }>();
    for (const path of paths) {
      const n = path.touchpoints.length;
      if (n === 0) continue;

      // Compute raw weights: last touch gets weight 1, earlier touches decay
      const weights: number[] = [];
      for (let i = 0; i < n; i++) {
        // Position 0 = first touch (oldest), n-1 = last touch (newest)
        // Days before conversion for position i
        const daysBefore = n === 1 ? 0 : ((n - 1 - i) / (n - 1)) * path.avgDaysToConvert;
        weights.push(Math.pow(2, -daysBefore / halfLife));
      }

      // Normalize weights
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      if (totalWeight === 0) continue;

      for (let i = 0; i < n; i++) {
        const channelId = path.touchpoints[i]!;
        const creditShare = weights[i]! / totalWeight;
        const existing = result.get(channelId) ?? { conversions: 0, revenue: 0 };
        existing.conversions += path.conversions * creditShare;
        existing.revenue += path.revenue * creditShare;
        result.set(channelId, existing);
      }
    }
    return result;
  }

  /**
   * position_based (U-shaped): 40% to first touch, 40% to last touch,
   * 20% split among middle touches.
   */
  private attributePositionBased(
    paths: ConversionPath[],
  ): Map<string, { conversions: number; revenue: number }> {
    const result = new Map<string, { conversions: number; revenue: number }>();
    for (const path of paths) {
      const n = path.touchpoints.length;
      if (n === 0) continue;

      if (n === 1) {
        // Single touch gets 100%
        const channelId = path.touchpoints[0]!;
        const existing = result.get(channelId) ?? { conversions: 0, revenue: 0 };
        existing.conversions += path.conversions;
        existing.revenue += path.revenue;
        result.set(channelId, existing);
      } else if (n === 2) {
        // Two touches: 50/50
        for (const channelId of path.touchpoints) {
          const existing = result.get(channelId) ?? { conversions: 0, revenue: 0 };
          existing.conversions += path.conversions * 0.5;
          existing.revenue += path.revenue * 0.5;
          result.set(channelId, existing);
        }
      } else {
        // 3+ touches: 40% first, 40% last, 20% split among middle
        const middleCount = n - 2;
        const middleCredit = 0.2 / middleCount;

        for (let i = 0; i < n; i++) {
          const channelId = path.touchpoints[i]!;
          let credit: number;
          if (i === 0) {
            credit = 0.4;
          } else if (i === n - 1) {
            credit = 0.4;
          } else {
            credit = middleCredit;
          }
          const existing = result.get(channelId) ?? { conversions: 0, revenue: 0 };
          existing.conversions += path.conversions * credit;
          existing.revenue += path.revenue * credit;
          result.set(channelId, existing);
        }
      }
    }
    return result;
  }

  /**
   * data_driven (Shapley values):
   * For each channel, compute its marginal contribution by looking at paths
   * with and without it.
   *
   * Simplified Shapley: for each channel c, compute the average marginal
   * contribution across all paths. The marginal contribution is estimated as:
   *   conversion_rate(paths_with_c) - conversion_rate(paths_without_c)
   *
   * Limit computation to top 10 channels by last-click volume; group rest
   * as "other".
   */
  private attributeDataDriven(
    channelMap: Map<string, Touchpoint>,
    paths: ConversionPath[],
  ): Map<string, { conversions: number; revenue: number }> {
    const result = new Map<string, { conversions: number; revenue: number }>();
    if (paths.length === 0) return result;

    // Get all unique channels from paths
    const allChannelIds = new Set<string>();
    for (const path of paths) {
      for (const chId of path.touchpoints) {
        allChannelIds.add(chId);
      }
    }

    // Limit to top 10 by last-click conversions, group rest as "other"
    const channelsByVolume = [...allChannelIds].sort((a, b) => {
      const aConv = channelMap.get(a)?.lastClickConversions ?? 0;
      const bConv = channelMap.get(b)?.lastClickConversions ?? 0;
      return bConv - aConv;
    });

    const topChannels = new Set(channelsByVolume.slice(0, 10));
    const otherChannels = new Set(channelsByVolume.slice(10));

    // Normalize paths: replace non-top channels with "other"
    const normalizedPaths = paths.map((p) => ({
      ...p,
      touchpoints: p.touchpoints.map((ch) =>
        topChannels.has(ch) ? ch : otherChannels.has(ch) ? "__other__" : ch,
      ),
    }));

    // Compute total conversions and revenue
    const totalConversions = paths.reduce((sum, p) => sum + p.conversions, 0);
    const totalRevenue = paths.reduce((sum, p) => sum + p.revenue, 0);

    // Compute Shapley values for each channel
    const shapleyValues = new Map<string, number>();
    const activeChannels = [...topChannels];
    if (otherChannels.size > 0) activeChannels.push("__other__");

    for (const channelId of activeChannels) {
      // Paths containing this channel
      const pathsWith = normalizedPaths.filter((p) => p.touchpoints.includes(channelId));
      // Paths not containing this channel
      const pathsWithout = normalizedPaths.filter((p) => !p.touchpoints.includes(channelId));

      const convWith =
        pathsWith.length > 0
          ? pathsWith.reduce((sum, p) => sum + p.conversions, 0) / pathsWith.length
          : 0;
      const convWithout =
        pathsWithout.length > 0
          ? pathsWithout.reduce((sum, p) => sum + p.conversions, 0) / pathsWithout.length
          : 0;

      // Marginal contribution (can be negative if channel appears in low-conversion paths)
      const marginalContribution = Math.max(0, convWith - convWithout);
      shapleyValues.set(channelId, marginalContribution);
    }

    // Normalize Shapley values to sum to total conversions
    const totalShapley = [...shapleyValues.values()].reduce((a, b) => a + b, 0);
    if (totalShapley === 0) {
      // Fallback to linear if Shapley computation yields nothing
      return this.attributeLinear(paths);
    }

    for (const [channelId, shapley] of shapleyValues) {
      const share = shapley / totalShapley;
      if (channelId === "__other__") {
        // Distribute "other" proportionally among the grouped channels
        if (otherChannels.size > 0) {
          const otherArr = [...otherChannels];
          const perChannel = share / otherArr.length;
          for (const otherId of otherArr) {
            result.set(otherId, {
              conversions: totalConversions * perChannel,
              revenue: totalRevenue * perChannel,
            });
          }
        }
      } else {
        result.set(channelId, {
          conversions: totalConversions * share,
          revenue: totalRevenue * share,
        });
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Private — Result building
  // -------------------------------------------------------------------------

  private buildChannelAttribution(
    touchpoints: Touchpoint[],
    attributionMap: Map<string, { conversions: number; revenue: number }>,
  ): MTAResult["channelAttribution"] {
    return touchpoints.map((tp) => {
      const attributed = attributionMap.get(tp.channelId) ?? {
        conversions: 0,
        revenue: 0,
      };

      const conversionDelta = attributed.conversions - tp.lastClickConversions;
      const conversionDeltaPercent =
        tp.lastClickConversions > 0
          ? (conversionDelta / tp.lastClickConversions) * 100
          : attributed.conversions > 0
            ? 100
            : 0;

      const attributedCPA =
        tp.spend > 0 && attributed.conversions > 0 ? tp.spend / attributed.conversions : null;

      const attributedROAS = tp.spend > 0 ? attributed.revenue / tp.spend : null;

      const roleScore = this.computeRoleScores(tp);
      const primaryRole = this.classifyRole(tp, roleScore);

      return {
        channelId: tp.channelId,
        channelName: tp.channelName,
        platform: tp.platform,
        lastClickConversions: tp.lastClickConversions,
        lastClickRevenue: tp.lastClickRevenue,
        attributedConversions: round(attributed.conversions, 2),
        attributedRevenue: round(attributed.revenue, 2),
        conversionDelta: round(conversionDelta, 2),
        conversionDeltaPercent: round(conversionDeltaPercent, 1),
        attributedCPA: attributedCPA !== null ? round(attributedCPA, 2) : null,
        attributedROAS: attributedROAS !== null ? round(attributedROAS, 2) : null,
        spend: tp.spend,
        primaryRole,
        roleScore,
      };
    });
  }

  private computeRoleScores(tp: Touchpoint): {
    introducer: number;
    influencer: number;
    closer: number;
  } {
    const total =
      tp.positionDistribution.first +
      tp.positionDistribution.middle +
      tp.positionDistribution.last +
      tp.positionDistribution.only;

    if (total === 0) {
      return { introducer: 0, influencer: 0, closer: 0 };
    }

    // "only" touches count toward both introducer and closer
    const introducerRaw = tp.positionDistribution.first + tp.positionDistribution.only * 0.5;
    const influencerRaw = tp.positionDistribution.middle;
    const closerRaw = tp.positionDistribution.last + tp.positionDistribution.only * 0.5;

    const rawTotal = introducerRaw + influencerRaw + closerRaw;
    if (rawTotal === 0) {
      return { introducer: 0, influencer: 0, closer: 0 };
    }

    return {
      introducer: round(introducerRaw / rawTotal, 3),
      influencer: round(influencerRaw / rawTotal, 3),
      closer: round(closerRaw / rawTotal, 3),
    };
  }

  private classifyRole(
    tp: Touchpoint,
    scores: { introducer: number; influencer: number; closer: number },
  ): "introducer" | "influencer" | "closer" | "independent" {
    // If "only" touches dominate, mark as independent
    const total =
      tp.positionDistribution.first +
      tp.positionDistribution.middle +
      tp.positionDistribution.last +
      tp.positionDistribution.only;

    if (total > 0 && tp.positionDistribution.only / total > 0.6) {
      return "independent";
    }

    const max = Math.max(scores.introducer, scores.influencer, scores.closer);
    if (max === 0) return "independent";
    if (max === scores.introducer) return "introducer";
    if (max === scores.closer) return "closer";
    return "influencer";
  }

  private computeTopPaths(paths: ConversionPath[]): MTAResult["topPaths"] {
    return [...paths]
      .sort((a, b) => b.conversions - a.conversions)
      .slice(0, 10)
      .map((p) => ({
        path: p.touchpoints,
        conversions: p.conversions,
        revenue: p.revenue,
        pathLength: p.touchpoints.length,
      }));
  }

  private computeInsights(
    touchpoints: Touchpoint[],
    paths: ConversionPath[],
    channelAttribution: MTAResult["channelAttribution"],
  ): MTAResult["insights"] {
    // Average path length
    const totalPaths = paths.reduce((sum, p) => sum + p.conversions, 0);
    const weightedPathLength = paths.reduce(
      (sum, p) => sum + p.touchpoints.length * p.conversions,
      0,
    );
    const avgPathLength = totalPaths > 0 ? weightedPathLength / totalPaths : 0;

    // Average days to convert
    const weightedDays = paths.reduce((sum, p) => sum + p.avgDaysToConvert * p.conversions, 0);
    const avgDaysToConvert = totalPaths > 0 ? weightedDays / totalPaths : 0;

    // Find most over- and under-valued channels (comparing model vs last-click)
    let mostOvervalued: { channelId: string; overvaluation: number } | null = null;
    let mostUndervalued: { channelId: string; undervaluation: number } | null = null;

    for (const ch of channelAttribution) {
      if (ch.lastClickConversions === 0 && ch.attributedConversions === 0) continue;

      // Overvalued = last-click gives more credit than model
      const overvaluation = ch.lastClickConversions - ch.attributedConversions;
      if (overvaluation > 0) {
        if (!mostOvervalued || overvaluation > mostOvervalued.overvaluation) {
          mostOvervalued = { channelId: ch.channelId, overvaluation: round(overvaluation, 2) };
        }
      }

      // Undervalued = model gives more credit than last-click
      const undervaluation = ch.attributedConversions - ch.lastClickConversions;
      if (undervaluation > 0) {
        if (!mostUndervalued || undervaluation > mostUndervalued.undervaluation) {
          mostUndervalued = {
            channelId: ch.channelId,
            undervaluation: round(undervaluation, 2),
          };
        }
      }
    }

    // Assist:conversion ratio — channels that assist (non-last-click) vs close
    const totalAssists = touchpoints.reduce(
      (sum, tp) => sum + tp.positionDistribution.first + tp.positionDistribution.middle,
      0,
    );
    const totalCloses = touchpoints.reduce(
      (sum, tp) => sum + tp.positionDistribution.last + tp.positionDistribution.only,
      0,
    );
    const assistConversionRatio = totalCloses > 0 ? totalAssists / totalCloses : 0;

    return {
      avgPathLength: round(avgPathLength, 1),
      avgDaysToConvert: round(avgDaysToConvert, 1),
      mostOvervaluedChannel: mostOvervalued,
      mostUndervaluedChannel: mostUndervalued,
      assistConversionRatio: round(assistConversionRatio, 2),
    };
  }

  private generateRecommendations(
    channelAttribution: MTAResult["channelAttribution"],
    insights: MTAResult["insights"],
  ): string[] {
    const recommendations: string[] = [];

    // Undervalued channels
    if (insights.mostUndervaluedChannel) {
      const ch = channelAttribution.find(
        (c) => c.channelId === insights.mostUndervaluedChannel!.channelId,
      );
      if (ch) {
        recommendations.push(
          `Channel "${ch.channelName}" is undervalued by last-click attribution by ` +
            `${insights.mostUndervaluedChannel.undervaluation.toFixed(1)} conversions. ` +
            `Consider increasing investment in this channel.`,
        );
      }
    }

    // Overvalued channels
    if (insights.mostOvervaluedChannel) {
      const ch = channelAttribution.find(
        (c) => c.channelId === insights.mostOvervaluedChannel!.channelId,
      );
      if (ch) {
        recommendations.push(
          `Channel "${ch.channelName}" is overvalued by last-click attribution by ` +
            `${insights.mostOvervaluedChannel.overvaluation.toFixed(1)} conversions. ` +
            `Review whether this channel's budget is justified.`,
        );
      }
    }

    // Introducer channels with low spend
    const introducers = channelAttribution.filter(
      (ch) => ch.primaryRole === "introducer" && ch.spend > 0,
    );
    if (introducers.length > 0) {
      const bestIntroducer = introducers.sort(
        (a, b) => b.roleScore.introducer - a.roleScore.introducer,
      )[0]!;
      if (bestIntroducer.conversionDeltaPercent > 20) {
        recommendations.push(
          `"${bestIntroducer.channelName}" is a strong introducer (score: ${(bestIntroducer.roleScore.introducer * 100).toFixed(0)}%). ` +
            `It drives awareness that leads to conversions through other channels. ` +
            `Budget cuts here may reduce overall conversions.`,
        );
      }
    }

    // Long path length
    if (insights.avgPathLength > 3) {
      recommendations.push(
        `Average conversion path length is ${insights.avgPathLength.toFixed(1)} touchpoints. ` +
          `Consider evaluating which mid-funnel channels are truly incremental ` +
          `vs. adding noise. A lift study can help validate.`,
      );
    }

    // High assist ratio
    if (insights.assistConversionRatio > 2) {
      recommendations.push(
        `Assist-to-conversion ratio is ${insights.assistConversionRatio.toFixed(1)}x, ` +
          `indicating heavy multi-touch journeys. Last-click attribution is likely ` +
          `misrepresenting channel value significantly. Consider position-based or ` +
          `data-driven models for budget decisions.`,
      );
    }

    // ROAS opportunities
    const highROAS = channelAttribution
      .filter((ch) => ch.attributedROAS !== null && ch.attributedROAS > 3 && ch.conversionDelta > 0)
      .sort((a, b) => (b.attributedROAS ?? 0) - (a.attributedROAS ?? 0));

    if (highROAS.length > 0) {
      const best = highROAS[0]!;
      recommendations.push(
        `"${best.channelName}" has high attributed ROAS (${best.attributedROAS!.toFixed(1)}x) ` +
          `and is undervalued by last-click. This is a strong candidate for budget increase.`,
      );
    }

    return recommendations;
  }

  private emptyResult(model: AttributionModel): MTAResult {
    return {
      model,
      channelAttribution: [],
      topPaths: [],
      insights: {
        avgPathLength: 0,
        avgDaysToConvert: 0,
        mostOvervaluedChannel: null,
        mostUndervaluedChannel: null,
        assistConversionRatio: 0,
      },
      recommendations: ["No touchpoint data available for attribution analysis."],
    };
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function channelMap(touchpoints: Touchpoint[], channelId: string): Touchpoint | undefined {
  return touchpoints.find((tp) => tp.channelId === channelId);
}
