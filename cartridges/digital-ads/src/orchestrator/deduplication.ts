// ---------------------------------------------------------------------------
// Cross-Platform Conversion Deduplication
// ---------------------------------------------------------------------------
// Estimates deduplicated conversion counts across Meta, Google, and TikTok
// using probabilistic overlap estimation. Supports statistical (correlation),
// time-decay (attribution window), and hybrid methods.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlatformConversionData {
  platform: 'meta' | 'google' | 'tiktok';
  /** Daily conversion data */
  dailyData: Array<{
    date: string;
    conversions: number;
    revenue: number;
    spend: number;
    impressions: number;
    clicks: number;
  }>;
  /** Attribution window used */
  attributionWindow: '1d_click' | '7d_click' | '28d_click' | '1d_view' | '7d_click_1d_view';
  /** Whether this platform uses last-click attribution */
  attributionModel: 'last_click' | 'data_driven' | 'first_click' | 'linear' | 'time_decay';
}

export interface DeduplicationResult {
  /** Per-platform raw totals */
  rawTotals: Array<{
    platform: string;
    totalConversions: number;
    totalRevenue: number;
    totalSpend: number;
  }>;
  /** Naive sum (just adding all platforms together) */
  naiveTotal: {
    conversions: number;
    revenue: number;
    spend: number;
  };
  /** Estimated deduplicated totals */
  deduplicatedTotal: {
    conversions: number;
    revenue: number;
    spend: number;
    blendedCPA: number;
    blendedROAS: number | null;
  };
  /** Overlap estimates */
  overlapEstimates: Array<{
    platforms: [string, string];
    estimatedOverlapRate: number;
    estimatedOverlappingConversions: number;
    confidence: 'high' | 'medium' | 'low';
    method: string;
  }>;
  /** Per-platform adjusted share */
  adjustedShare: Array<{
    platform: string;
    rawConversions: number;
    adjustedConversions: number;
    adjustmentFactor: number;
    estimatedTrueShare: number;
  }>;
  /** Total overcounting factor (naive/deduplicated) */
  overcountingFactor: number;
  /** Methodology notes */
  methodology: string[];
  /** Recommendations */
  recommendations: string[];
}

export interface OverlapEstimationConfig {
  /** Method for estimating overlap */
  method: 'statistical' | 'time_decay' | 'hybrid';
  /** Base overlap rate to use when insufficient data (default: 0.15 for Meta+Google) */
  defaultOverlapRates?: Record<string, number>;
  /** Minimum days of data required for statistical estimation */
  minDaysForStatistical?: number;
}

// ---------------------------------------------------------------------------
// Default overlap rates (research-based estimates)
// ---------------------------------------------------------------------------

const DEFAULT_OVERLAP_RATES: Record<string, number> = {
  'meta+google': 0.20,    // 15-25% overlap — broad reach overlap
  'google+meta': 0.20,
  'meta+tiktok': 0.15,    // 10-20% overlap — younger demo overlap
  'tiktok+meta': 0.15,
  'google+tiktok': 0.12,  // 8-15% overlap — less audience overlap
  'tiktok+google': 0.12,
};

const THREE_WAY_OVERLAP_FRACTION = 0.35; // ~35% of smallest pairwise overlap

// ---------------------------------------------------------------------------
// Attribution window overlap factors for time-decay method
// ---------------------------------------------------------------------------

interface WindowOverlapFactor {
  overlapRate: number;
  description: string;
}

function getWindowOverlapFactor(
  window1: PlatformConversionData['attributionWindow'],
  window2: PlatformConversionData['attributionWindow'],
): WindowOverlapFactor {
  // Same-day click windows have minimal overlap
  if (window1 === '1d_click' && window2 === '1d_click') {
    return { overlapRate: 0.05, description: 'same-day click windows — minimal overlap' };
  }

  // 7d_click overlapping with 1d_click: ~30% of 1d conversions re-counted
  if (
    (window1 === '7d_click' && window2 === '1d_click') ||
    (window1 === '1d_click' && window2 === '7d_click')
  ) {
    return { overlapRate: 0.30, description: '7d_click vs 1d_click — moderate overlap from extended window' };
  }

  // 28d_click overlapping with 7d_click: ~40% of 7d conversions re-counted
  if (
    (window1 === '28d_click' && window2 === '7d_click') ||
    (window1 === '7d_click' && window2 === '28d_click')
  ) {
    return { overlapRate: 0.40, description: '28d_click vs 7d_click — significant overlap from long window' };
  }

  // 28d_click overlapping with 1d_click: ~35% overlap
  if (
    (window1 === '28d_click' && window2 === '1d_click') ||
    (window1 === '1d_click' && window2 === '28d_click')
  ) {
    return { overlapRate: 0.35, description: '28d_click vs 1d_click — significant window mismatch overlap' };
  }

  // View-through windows add ~15% to any click-based
  if (window1 === '1d_view' || window2 === '1d_view') {
    return { overlapRate: 0.15, description: 'view-through window adds incremental overlap' };
  }

  // 7d_click_1d_view is a combined window — higher overlap
  if (window1 === '7d_click_1d_view' || window2 === '7d_click_1d_view') {
    const otherWindow = window1 === '7d_click_1d_view' ? window2 : window1;
    if (otherWindow === '7d_click' || otherWindow === '28d_click') {
      return { overlapRate: 0.35, description: 'combined click+view window vs click window — high overlap' };
    }
    if (otherWindow === '1d_click') {
      return { overlapRate: 0.25, description: 'combined click+view window vs 1d click — moderate overlap' };
    }
    // Both are 7d_click_1d_view
    return { overlapRate: 0.30, description: 'matching combined windows — significant overlap' };
  }

  // Same windows (7d_click vs 7d_click, etc.)
  if (window1 === window2) {
    return { overlapRate: 0.20, description: 'matching attribution windows — standard overlap' };
  }

  // Default fallback
  return { overlapRate: 0.15, description: 'mixed attribution windows — estimated overlap' };
}

// ---------------------------------------------------------------------------
// Baseline correlation for shared seasonality
// ---------------------------------------------------------------------------

// Daily ad platform metrics naturally correlate due to shared day-of-week
// patterns, holidays, and seasonal trends. This baseline accounts for that.
const BASELINE_CORRELATION = 0.3;

// ---------------------------------------------------------------------------
// ConversionDeduplicator
// ---------------------------------------------------------------------------

export class ConversionDeduplicator {
  /**
   * Main deduplication method.
   * Takes per-platform conversion data and estimates true deduplicated totals.
   */
  deduplicate(
    platforms: PlatformConversionData[],
    config?: OverlapEstimationConfig,
  ): DeduplicationResult {
    const method = config?.method ?? 'hybrid';
    const overlapRates = config?.defaultOverlapRates ?? DEFAULT_OVERLAP_RATES;
    const minDays = config?.minDaysForStatistical ?? 14;
    const methodology: string[] = [];
    const recommendations: string[] = [];

    // Step 1: Compute raw per-platform totals
    const rawTotals = platforms.map((p) => {
      const totalConversions = p.dailyData.reduce((sum, d) => sum + d.conversions, 0);
      const totalRevenue = p.dailyData.reduce((sum, d) => sum + d.revenue, 0);
      const totalSpend = p.dailyData.reduce((sum, d) => sum + d.spend, 0);
      return {
        platform: p.platform,
        totalConversions,
        totalRevenue,
        totalSpend,
      };
    });

    const naiveTotal = {
      conversions: rawTotals.reduce((sum, r) => sum + r.totalConversions, 0),
      revenue: rawTotals.reduce((sum, r) => sum + r.totalRevenue, 0),
      spend: rawTotals.reduce((sum, r) => sum + r.totalSpend, 0),
    };

    methodology.push(
      `Analyzed ${platforms.length} platform(s) with naive total of ${naiveTotal.conversions.toLocaleString()} conversions.`,
    );

    // Step 2: Estimate pairwise overlaps
    const overlapEstimates: DeduplicationResult['overlapEstimates'] = [];
    const pairwiseOverlaps = new Map<string, number>(); // "p1+p2" → overlapping conversions

    for (let i = 0; i < platforms.length; i++) {
      for (let j = i + 1; j < platforms.length; j++) {
        const p1 = platforms[i]!;
        const p2 = platforms[j]!;

        const overlap = this.estimatePairwiseOverlap(p1, p2, method, overlapRates, minDays);

        const pairKey = `${p1.platform}+${p2.platform}`;
        pairwiseOverlaps.set(pairKey, overlap.overlappingConversions);

        overlapEstimates.push({
          platforms: [p1.platform, p2.platform],
          estimatedOverlapRate: overlap.overlapRate,
          estimatedOverlappingConversions: overlap.overlappingConversions,
          confidence: overlap.confidence as 'high' | 'medium' | 'low',
          method: overlap.method,
        });

        methodology.push(
          `${p1.platform} + ${p2.platform}: estimated ${(overlap.overlapRate * 100).toFixed(1)}% overlap ` +
          `(~${Math.round(overlap.overlappingConversions)} shared conversions) via ${overlap.method} method ` +
          `[${overlap.confidence} confidence].`,
        );
      }
    }

    // Step 3: Apply inclusion-exclusion to compute deduplicated total
    let totalOverlap = 0;

    // Sum pairwise overlaps
    for (const count of pairwiseOverlaps.values()) {
      totalOverlap += count;
    }

    // For 3 platforms, estimate triple overlap and add back (inclusion-exclusion)
    let tripleOverlap = 0;
    if (platforms.length === 3) {
      // Estimate |A∩B∩C| as a fraction of the smallest pairwise overlap
      const overlapValues = Array.from(pairwiseOverlaps.values());
      const smallestPairwise = Math.min(...overlapValues);
      tripleOverlap = smallestPairwise * THREE_WAY_OVERLAP_FRACTION;

      // Inclusion-exclusion: add back the triple overlap
      totalOverlap -= tripleOverlap;

      methodology.push(
        `Three-platform overlap estimated at ~${Math.round(tripleOverlap)} conversions ` +
        `(${(THREE_WAY_OVERLAP_FRACTION * 100).toFixed(0)}% of smallest pairwise overlap).`,
      );
    }

    // Deduplicated conversions cannot go below the single largest platform
    const maxPlatformConversions = Math.max(...rawTotals.map((r) => r.totalConversions));
    const deduplicatedConversions = Math.max(
      maxPlatformConversions,
      naiveTotal.conversions - totalOverlap,
    );

    // Apply same reduction ratio to revenue
    const reductionRatio = naiveTotal.conversions > 0
      ? deduplicatedConversions / naiveTotal.conversions
      : 1;
    const deduplicatedRevenue = naiveTotal.revenue * reductionRatio;

    // Spend is real — no deduplication needed
    const deduplicatedSpend = naiveTotal.spend;

    // Blended metrics on deduplicated numbers
    const blendedCPA = deduplicatedConversions > 0
      ? deduplicatedSpend / deduplicatedConversions
      : 0;
    const blendedROAS = deduplicatedSpend > 0
      ? deduplicatedRevenue / deduplicatedSpend
      : null;

    const deduplicatedTotal = {
      conversions: Math.round(deduplicatedConversions),
      revenue: Math.round(deduplicatedRevenue * 100) / 100,
      spend: Math.round(deduplicatedSpend * 100) / 100,
      blendedCPA: Math.round(blendedCPA * 100) / 100,
      blendedROAS: blendedROAS !== null ? Math.round(blendedROAS * 100) / 100 : null,
    };

    // Step 4: Compute adjusted per-platform shares (proportional reduction)
    const adjustedShare = rawTotals.map((r) => {
      const adjustedConversions = r.totalConversions * reductionRatio;
      return {
        platform: r.platform,
        rawConversions: r.totalConversions,
        adjustedConversions: Math.round(adjustedConversions),
        adjustmentFactor: Math.round(reductionRatio * 1000) / 1000,
        estimatedTrueShare: deduplicatedConversions > 0
          ? Math.round((adjustedConversions / deduplicatedConversions) * 1000) / 1000
          : 0,
      };
    });

    // Overcounting factor
    const overcountingFactor = deduplicatedConversions > 0
      ? Math.round((naiveTotal.conversions / deduplicatedConversions) * 100) / 100
      : 1;

    methodology.push(
      `Overcounting factor: ${overcountingFactor.toFixed(2)}x (naive ${naiveTotal.conversions.toLocaleString()} → ` +
      `deduplicated ${deduplicatedTotal.conversions.toLocaleString()}).`,
    );

    // Step 5: Generate recommendations
    if (overcountingFactor > 1.3) {
      recommendations.push(
        'Significant overcounting detected (>30%). Consider using a unified measurement tool ' +
        '(e.g., MMM or incrementality tests) to validate these estimates.',
      );
    }

    if (overcountingFactor > 1.5) {
      recommendations.push(
        'Over 50% overcounting suggests heavy audience overlap. Evaluate whether all platforms ' +
        'are targeting sufficiently distinct audiences, or consolidate to reduce wasted overlap.',
      );
    }

    // Check for attribution window mismatches
    const windows = new Set(platforms.map((p) => p.attributionWindow));
    if (windows.size > 1) {
      recommendations.push(
        'Attribution windows differ across platforms. Align windows where possible (e.g., all ' +
        'using 7d_click) to improve comparability and reduce attribution-driven overcounting.',
      );
    }

    // Check for mismatched attribution models
    const models = new Set(platforms.map((p) => p.attributionModel));
    if (models.size > 1) {
      recommendations.push(
        'Attribution models differ across platforms. Last-click models on multiple platforms ' +
        'will naturally overcount. Consider data-driven or first-click where available.',
      );
    }

    // Blended CPA recommendation
    if (deduplicatedTotal.blendedCPA > 0) {
      const naiveCPA = naiveTotal.conversions > 0
        ? naiveTotal.spend / naiveTotal.conversions
        : 0;
      if (naiveCPA > 0) {
        const cpaIncrease = ((deduplicatedTotal.blendedCPA - naiveCPA) / naiveCPA) * 100;
        recommendations.push(
          `Deduplicated blended CPA ($${deduplicatedTotal.blendedCPA.toFixed(2)}) is ${cpaIncrease.toFixed(0)}% ` +
          `higher than naive CPA ($${naiveCPA.toFixed(2)}). Use deduplicated CPA for accurate budget planning.`,
        );
      }
    }

    // Specific per-pair recommendations
    for (const est of overlapEstimates) {
      if (est.estimatedOverlapRate > 0.25) {
        recommendations.push(
          `High overlap between ${est.platforms[0]} and ${est.platforms[1]} ` +
          `(${(est.estimatedOverlapRate * 100).toFixed(0)}%). Consider running a holdout test ` +
          `on one platform to measure true incremental lift.`,
        );
      }
    }

    return {
      rawTotals,
      naiveTotal,
      deduplicatedTotal,
      overlapEstimates,
      adjustedShare,
      overcountingFactor,
      methodology,
      recommendations,
    };
  }

  /**
   * Estimates overlap between two specific platforms.
   */
  estimatePairwiseOverlap(
    platform1: PlatformConversionData,
    platform2: PlatformConversionData,
    method: string,
    overlapRates?: Record<string, number>,
    minDaysForStatistical?: number,
  ): {
    overlapRate: number;
    confidence: string;
    overlappingConversions: number;
    method: string;
  } {
    const rates = overlapRates ?? DEFAULT_OVERLAP_RATES;
    const minDays = minDaysForStatistical ?? 14;

    const p1Total = platform1.dailyData.reduce((sum, d) => sum + d.conversions, 0);
    const p2Total = platform2.dailyData.reduce((sum, d) => sum + d.conversions, 0);
    const smallerTotal = Math.min(p1Total, p2Total);

    // Get default overlap rate for this pair
    const pairKey = `${platform1.platform}+${platform2.platform}`;
    const defaultRate = rates[pairKey] ?? DEFAULT_OVERLAP_RATES[pairKey] ?? 0.15;

    switch (method) {
      case 'statistical':
        return this.estimateStatistical(
          platform1, platform2, smallerTotal, defaultRate, minDays,
        );

      case 'time_decay':
        return this.estimateTimeDecay(
          platform1, platform2, smallerTotal, defaultRate,
        );

      case 'hybrid':
      default:
        return this.estimateHybrid(
          platform1, platform2, smallerTotal, defaultRate, minDays,
        );
    }
  }

  /**
   * Pearson correlation coefficient between two series.
   */
  computeCorrelation(series1: number[], series2: number[]): number {
    const n = Math.min(series1.length, series2.length);
    if (n < 3) return 0;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    let sumY2 = 0;

    for (let i = 0; i < n; i++) {
      const x = series1[i]!;
      const y = series2[i]!;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
      sumY2 += y * y;
    }

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt(
      (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY),
    );

    if (denominator === 0) return 0;

    return numerator / denominator;
  }

  // ---------------------------------------------------------------------------
  // Private estimation methods
  // ---------------------------------------------------------------------------

  private estimateStatistical(
    platform1: PlatformConversionData,
    platform2: PlatformConversionData,
    smallerTotal: number,
    defaultRate: number,
    minDays: number,
  ): {
    overlapRate: number;
    confidence: string;
    overlappingConversions: number;
    method: string;
  } {
    // Align daily data by date
    const aligned = this.alignDailyData(platform1, platform2);

    if (aligned.length < minDays) {
      // Insufficient data — fall back to default rate
      return {
        overlapRate: defaultRate,
        confidence: 'low',
        overlappingConversions: Math.round(smallerTotal * defaultRate),
        method: 'statistical (insufficient data — used default rate)',
      };
    }

    const series1 = aligned.map((d) => d.conv1);
    const series2 = aligned.map((d) => d.conv2);

    const r = this.computeCorrelation(series1, series2);

    // Estimate overlap rate from correlation
    // Higher correlation → higher overlap
    // Subtract baseline correlation that accounts for shared seasonality
    const adjustedR = Math.max(0, (r - BASELINE_CORRELATION) / (1 - BASELINE_CORRELATION));

    // Scale: adjustedR of 1.0 means ~50% overlap (not 100%, as correlation doesn't imply identity)
    const overlapRate = Math.min(adjustedR * 0.5, 0.6);

    // Determine confidence based on data quality
    let confidence: string;
    if (aligned.length >= 30 && Math.abs(r) > 0.5) {
      confidence = 'high';
    } else if (aligned.length >= 14) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return {
      overlapRate: Math.round(overlapRate * 1000) / 1000,
      confidence,
      overlappingConversions: Math.round(smallerTotal * overlapRate),
      method: `statistical (r=${r.toFixed(3)}, ${aligned.length} days, adjusted overlap=${(overlapRate * 100).toFixed(1)}%)`,
    };
  }

  private estimateTimeDecay(
    platform1: PlatformConversionData,
    platform2: PlatformConversionData,
    smallerTotal: number,
    defaultRate: number,
  ): {
    overlapRate: number;
    confidence: string;
    overlappingConversions: number;
    method: string;
  } {
    const windowFactor = getWindowOverlapFactor(
      platform1.attributionWindow,
      platform2.attributionWindow,
    );

    // Blend the window-based factor with the default platform-pair rate
    // Window factor captures attribution mechanics, default rate captures audience overlap
    const blendedRate = (windowFactor.overlapRate + defaultRate) / 2;

    // Add view-through premium if applicable
    let viewThroughAdj = 0;
    if (platform1.attributionWindow === '1d_view' || platform2.attributionWindow === '1d_view') {
      viewThroughAdj = 0.15;
    }

    const finalRate = Math.min(blendedRate + viewThroughAdj, 0.6);

    return {
      overlapRate: Math.round(finalRate * 1000) / 1000,
      confidence: 'medium',
      overlappingConversions: Math.round(smallerTotal * finalRate),
      method: `time_decay (${windowFactor.description}, blended rate=${(finalRate * 100).toFixed(1)}%)`,
    };
  }

  private estimateHybrid(
    platform1: PlatformConversionData,
    platform2: PlatformConversionData,
    smallerTotal: number,
    defaultRate: number,
    minDays: number,
  ): {
    overlapRate: number;
    confidence: string;
    overlappingConversions: number;
    method: string;
  } {
    const aligned = this.alignDailyData(platform1, platform2);
    const hasEnoughData = aligned.length >= minDays;

    if (!hasEnoughData) {
      // Fall back to time-decay only
      return this.estimateTimeDecay(platform1, platform2, smallerTotal, defaultRate);
    }

    // Get both estimates
    const statistical = this.estimateStatistical(
      platform1, platform2, smallerTotal, defaultRate, minDays,
    );
    const timeDecay = this.estimateTimeDecay(
      platform1, platform2, smallerTotal, defaultRate,
    );

    // Weighted average: statistical gets more weight with more data
    const statisticalWeight = Math.min(aligned.length / 30, 0.7);
    const timeDecayWeight = 1 - statisticalWeight;

    const blendedRate = statistical.overlapRate * statisticalWeight +
      timeDecay.overlapRate * timeDecayWeight;

    // Confidence is the higher of the two
    const confidenceOrder = ['low', 'medium', 'high'];
    const statIdx = confidenceOrder.indexOf(statistical.confidence);
    const tdIdx = confidenceOrder.indexOf(timeDecay.confidence);
    const confidence = confidenceOrder[Math.max(statIdx, tdIdx)]!;

    return {
      overlapRate: Math.round(blendedRate * 1000) / 1000,
      confidence,
      overlappingConversions: Math.round(smallerTotal * blendedRate),
      method: `hybrid (statistical weight=${(statisticalWeight * 100).toFixed(0)}%, ` +
        `time_decay weight=${(timeDecayWeight * 100).toFixed(0)}%, ` +
        `blended rate=${(blendedRate * 100).toFixed(1)}%)`,
    };
  }

  /**
   * Align daily data from two platforms by date, returning only days
   * present in both datasets.
   */
  private alignDailyData(
    platform1: PlatformConversionData,
    platform2: PlatformConversionData,
  ): Array<{ date: string; conv1: number; conv2: number }> {
    const p1Map = new Map(platform1.dailyData.map((d) => [d.date, d.conversions]));
    const p2Map = new Map(platform2.dailyData.map((d) => [d.date, d.conversions]));

    const commonDates = [...p1Map.keys()].filter((date) => p2Map.has(date)).sort();

    return commonDates.map((date) => ({
      date,
      conv1: p1Map.get(date)!,
      conv2: p2Map.get(date)!,
    }));
  }
}
