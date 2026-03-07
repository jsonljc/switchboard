// ---------------------------------------------------------------------------
// Headroom Model 3.1 — Spend vs. Conversions Response Curve Engine
// ---------------------------------------------------------------------------
// Fits daily spend-vs-outcome data to log and power-law curves to estimate
// how much additional spend an account/campaign can absorb before hitting
// a CPA/ROAS target. Implements the "Methodology Evaluation" improvements:
//
// 1. Dual-model fit (log + power-law, best R² wins)
// 2. Tiered confidence (high ≥0.65, medium 0.5-0.65, low <0.5)
// 3. Time-weighting (recent days weighted higher)
// 4. Confidence bands via bootstrap resampling
// 5. Data quality checks (variability, gaps, minimum days)
// 6. 2x safety cap on recommended spend increase
// ---------------------------------------------------------------------------

import { getActiveSeasonalEvent } from "./seasonality.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyDataPoint {
  date: string; // YYYY-MM-DD
  spend: number;
  conversions: number;
  revenue: number | null;
  ctr: number | null;
}

export interface HeadroomModelConfig {
  /** Target CPA (optional — if set, model calculates spend level to stay under target) */
  targetCPA?: number;
  /** Target ROAS (optional) */
  targetROAS?: number;
  /** Time-decay half-life in days (default 14 = recent 14 days weighted 2x) */
  decayHalfLifeDays?: number;
  /** Number of bootstrap samples for confidence bands (default 200) */
  bootstrapSamples?: number;
  /** Custom safety cap multiplier (default 2.0 = max 2x current spend) */
  safetyCap?: number;
}

export type ModelType = "logarithmic" | "power-law";

export type ConfidenceTier = "high" | "medium" | "low";

export interface FittedCurve {
  modelType: ModelType;
  /** Coefficients: log → [a, b] for y = a*ln(x) + b, power → [a, b] for y = a*x^b */
  coefficients: [number, number];
  /** R-squared goodness of fit */
  rSquared: number;
  /** For power-law, the exponent b is the spend elasticity */
  elasticity: number | null;
}

export interface DataQualityReport {
  /** Total data points after cleaning */
  cleanPointCount: number;
  /** Points removed by IQR outlier filter */
  outliersRemoved: number;
  /** Days with zero spend (gaps) */
  gapDays: number;
  /** Coefficient of variation of spend (stddev/mean) */
  spendCV: number;
  /** Whether spend variability is too low for reliable modeling */
  lowVariability: boolean;
  /** Whether the data period spans a known seasonal boundary */
  seasonalBoundary: boolean;
  /** Active seasonal event name, if any */
  seasonalEventName: string | null;
}

export interface HeadroomEstimate {
  /** Current average daily spend */
  currentDailySpend: number;
  /** Recommended optimal daily spend */
  recommendedDailySpend: number;
  /** Headroom percentage — how much more can be spent */
  headroomPercent: number;
  /** Predicted conversions at recommended spend level */
  predictedConversions: number;
  /** Predicted CPA at recommended spend level */
  predictedCPA: number | null;
  /** Predicted ROAS at recommended spend level */
  predictedROAS: number | null;
}

export interface ConfidenceBand {
  /** Lower bound of the headroom estimate (10th percentile) */
  lowerPercent: number;
  /** Upper bound of the headroom estimate (90th percentile) */
  upperPercent: number;
}

export interface HeadroomResult {
  /** The best-fitting curve (highest R²) */
  selectedModel: FittedCurve;
  /** The alternative model (for comparison) */
  alternativeModel: FittedCurve;
  /** Confidence tier based on R² of selected model */
  confidence: ConfidenceTier;
  /** The headroom estimate */
  estimate: HeadroomEstimate;
  /** Bootstrap confidence band on headroom percent */
  confidenceBand: ConfidenceBand;
  /** Data quality assessment */
  dataQuality: DataQualityReport;
  /** Caveats and warnings */
  caveats: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_DATA_POINTS = 21;
const R_SQUARED_HIGH = 0.65;
const R_SQUARED_MEDIUM = 0.5;
const DEFAULT_DECAY_HALF_LIFE = 14;
const DEFAULT_BOOTSTRAP_SAMPLES = 200;
const DEFAULT_SAFETY_CAP = 2.0;
const LOW_VARIABILITY_CV = 0.15;
const IQR_MULTIPLIER = 1.5;

// ---------------------------------------------------------------------------
// Core regression engine
// ---------------------------------------------------------------------------

/**
 * Run the full headroom analysis on daily spend/conversion data.
 *
 * Returns null if there is insufficient data (< 21 clean days).
 */
export function analyzeHeadroom(
  data: DailyDataPoint[],
  config: HeadroomModelConfig = {},
): HeadroomResult | null {
  const decayHalfLife = config.decayHalfLifeDays ?? DEFAULT_DECAY_HALF_LIFE;
  const bootstrapN = config.bootstrapSamples ?? DEFAULT_BOOTSTRAP_SAMPLES;
  const safetyCap = config.safetyCap ?? DEFAULT_SAFETY_CAP;

  // 1. Clean and validate data
  const { cleaned, outliersRemoved, gapDays } = cleanData(data);

  if (cleaned.length < MIN_DATA_POINTS) {
    return null;
  }

  // 2. Compute data quality metrics
  const dataQuality = assessDataQuality(cleaned, outliersRemoved, gapDays, data);

  // 3. Compute time-decay weights
  const weights = computeTimeWeights(cleaned, decayHalfLife);

  // 4. Fit both models
  const spendValues = cleaned.map((d) => d.spend);
  const conversionValues = cleaned.map((d) => d.conversions);

  const logModel = fitLogModel(spendValues, conversionValues, weights);
  const powerModel = fitPowerModel(spendValues, conversionValues, weights);

  // 5. Select best model by R²
  const [selectedModel, alternativeModel] =
    logModel.rSquared >= powerModel.rSquared ? [logModel, powerModel] : [powerModel, logModel];

  // 6. Determine confidence tier
  const confidence = classifyConfidence(selectedModel.rSquared);

  // 7. Compute headroom estimate
  const currentDailySpend = weightedMean(spendValues, weights);
  const estimate = computeHeadroomEstimate(
    selectedModel,
    currentDailySpend,
    conversionValues,
    cleaned,
    config,
    safetyCap,
  );

  // 8. Bootstrap confidence bands
  const confidenceBand = bootstrapConfidenceBand(
    cleaned,
    weights,
    selectedModel.modelType,
    currentDailySpend,
    config,
    safetyCap,
    bootstrapN,
  );

  // 9. Generate caveats
  const caveats = generateCaveats(dataQuality, confidence, selectedModel);

  return {
    selectedModel,
    alternativeModel,
    confidence,
    estimate,
    confidenceBand,
    dataQuality,
    caveats,
  };
}

// ---------------------------------------------------------------------------
// Data cleaning
// ---------------------------------------------------------------------------

interface CleanResult {
  cleaned: DailyDataPoint[];
  outliersRemoved: number;
  gapDays: number;
}

/**
 * Remove zero-spend days and IQR-based outliers.
 */
export function cleanData(data: DailyDataPoint[]): CleanResult {
  // Remove zero-spend days
  const nonZero = data.filter((d) => d.spend > 0 && d.conversions >= 0);
  const gapDays = data.length - nonZero.length;

  if (nonZero.length < 4) {
    return { cleaned: nonZero, outliersRemoved: 0, gapDays };
  }

  // IQR outlier removal on spend
  const spendValues = nonZero.map((d) => d.spend).sort((a, b) => a - b);
  const q1 = percentile(spendValues, 25);
  const q3 = percentile(spendValues, 75);
  const iqr = q3 - q1;

  const lowerBound = q1 - IQR_MULTIPLIER * iqr;
  const upperBound = q3 + IQR_MULTIPLIER * iqr;

  const cleaned = nonZero.filter((d) => d.spend >= lowerBound && d.spend <= upperBound);
  const outliersRemoved = nonZero.length - cleaned.length;

  return { cleaned, outliersRemoved, gapDays };
}

// ---------------------------------------------------------------------------
// Data quality assessment
// ---------------------------------------------------------------------------

function assessDataQuality(
  cleaned: DailyDataPoint[],
  outliersRemoved: number,
  gapDays: number,
  rawData: DailyDataPoint[],
): DataQualityReport {
  const spendValues = cleaned.map((d) => d.spend);
  const mean = spendValues.reduce((a, b) => a + b, 0) / spendValues.length;
  const variance =
    spendValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / spendValues.length;
  const stdDev = Math.sqrt(variance);
  const spendCV = mean > 0 ? stdDev / mean : 0;

  // Check if data spans a seasonal boundary
  const dates = rawData.map((d) => d.date).sort();
  const firstDate = dates[0] ?? "";
  const lastDate = dates[dates.length - 1] ?? "";
  const seasonalEvent = getActiveSeasonalEvent(firstDate, lastDate);

  return {
    cleanPointCount: cleaned.length,
    outliersRemoved,
    gapDays,
    spendCV,
    lowVariability: spendCV < LOW_VARIABILITY_CV,
    seasonalBoundary: seasonalEvent !== null,
    seasonalEventName: seasonalEvent?.name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Time-decay weighting
// ---------------------------------------------------------------------------

/**
 * Compute exponential decay weights where recent days carry more weight.
 * weight_i = e^(-λ * days_ago_i), where λ = ln(2) / halfLifeDays.
 */
export function computeTimeWeights(data: DailyDataPoint[], halfLifeDays: number): number[] {
  if (data.length === 0) return [];

  const lambda = Math.LN2 / halfLifeDays;
  const dates = data.map((d) => new Date(d.date).getTime());
  const maxDate = Math.max(...dates);

  const rawWeights = dates.map((t) => {
    const daysAgo = (maxDate - t) / (1000 * 60 * 60 * 24);
    return Math.exp(-lambda * daysAgo);
  });

  // Normalize so weights sum to data.length (preserves effective sample size semantics)
  const sum = rawWeights.reduce((a, b) => a + b, 0);
  const scale = data.length / sum;
  return rawWeights.map((w) => w * scale);
}

// ---------------------------------------------------------------------------
// Weighted least-squares regression
// ---------------------------------------------------------------------------

/**
 * Fit y = a * ln(x) + b using weighted least squares.
 */
export function fitLogModel(x: number[], y: number[], weights: number[]): FittedCurve {
  const lnX = x.map((v) => Math.log(v));
  const { a, b, rSquared } = weightedLinearRegression(lnX, y, weights);

  return {
    modelType: "logarithmic",
    coefficients: [a, b],
    rSquared,
    elasticity: null,
  };
}

/**
 * Fit y = a * x^b by linearizing: ln(y) = ln(a) + b*ln(x).
 * Uses weighted least squares on the log-transformed data.
 */
export function fitPowerModel(x: number[], y: number[], weights: number[]): FittedCurve {
  // Filter out zero-conversion days (can't log-transform 0)
  const valid: Array<{ lnX: number; lnY: number; w: number; origY: number }> = [];
  for (let i = 0; i < x.length; i++) {
    if (y[i]! > 0) {
      valid.push({ lnX: Math.log(x[i]!), lnY: Math.log(y[i]!), w: weights[i]!, origY: y[i]! });
    }
  }

  if (valid.length < MIN_DATA_POINTS) {
    return {
      modelType: "power-law",
      coefficients: [0, 0],
      rSquared: 0,
      elasticity: null,
    };
  }

  const lnXArr = valid.map((v) => v.lnX);
  const lnYArr = valid.map((v) => v.lnY);
  const wArr = valid.map((v) => v.w);

  const {
    a: lnA,
    b: elasticity,
    rSquared: logSpaceR2,
  } = weightedLinearRegression(lnXArr, lnYArr, wArr);

  const aCoeff = Math.exp(lnA);

  // Re-compute R² in the original space for fair comparison with log model
  const origY = valid.map((v) => v.origY);
  const origX = valid.map((v) => Math.exp(v.lnX));
  const predicted = origX.map((xi) => aCoeff * Math.pow(xi, elasticity));
  const realSpaceR2 = computeRSquared(origY, predicted, wArr);

  // Use the better of log-space and real-space R²
  const rSquared = Math.max(logSpaceR2, realSpaceR2);

  return {
    modelType: "power-law",
    coefficients: [aCoeff, elasticity],
    rSquared,
    elasticity,
  };
}

/**
 * Weighted ordinary least-squares for y = a*x + b.
 * Returns slope (a), intercept (b), and R².
 */
function weightedLinearRegression(
  x: number[],
  y: number[],
  weights: number[],
): { a: number; b: number; rSquared: number } {
  const n = x.length;
  if (n < 2) return { a: 0, b: 0, rSquared: 0 };

  let sumW = 0;
  let sumWX = 0;
  let sumWY = 0;
  let sumWXX = 0;
  let sumWXY = 0;

  for (let i = 0; i < n; i++) {
    const w = weights[i]!;
    const xi = x[i]!;
    const yi = y[i]!;
    sumW += w;
    sumWX += w * xi;
    sumWY += w * yi;
    sumWXX += w * xi * xi;
    sumWXY += w * xi * yi;
  }

  const denom = sumW * sumWXX - sumWX * sumWX;
  if (Math.abs(denom) < 1e-12) {
    return { a: 0, b: sumWY / sumW, rSquared: 0 };
  }

  const a = (sumW * sumWXY - sumWX * sumWY) / denom;
  const b = (sumWY - a * sumWX) / sumW;

  // Compute weighted R²
  const predicted = x.map((xi) => a * xi + b);
  const rSquared = computeRSquared(y, predicted, weights);

  return { a, b, rSquared };
}

/**
 * Compute weighted R-squared.
 */
function computeRSquared(actual: number[], predicted: number[], weights: number[]): number {
  const n = actual.length;
  let sumW = 0;
  let sumWY = 0;

  for (let i = 0; i < n; i++) {
    sumW += weights[i]!;
    sumWY += weights[i]! * actual[i]!;
  }

  const wMean = sumWY / sumW;

  let ssRes = 0;
  let ssTot = 0;

  for (let i = 0; i < n; i++) {
    const w = weights[i]!;
    ssRes += w * Math.pow(actual[i]! - predicted[i]!, 2);
    ssTot += w * Math.pow(actual[i]! - wMean, 2);
  }

  if (ssTot < 1e-12) return 0;
  return Math.max(0, 1 - ssRes / ssTot);
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

/**
 * Predict conversions at a given spend level using the fitted curve.
 */
export function predictConversions(model: FittedCurve, spend: number): number {
  const [a, b] = model.coefficients;
  if (spend <= 0) return 0;

  if (model.modelType === "logarithmic") {
    return Math.max(0, a * Math.log(spend) + b);
  }
  // power-law: y = a * x^b
  return Math.max(0, a * Math.pow(spend, b));
}

// ---------------------------------------------------------------------------
// Headroom estimation
// ---------------------------------------------------------------------------

function computeHeadroomEstimate(
  model: FittedCurve,
  currentDailySpend: number,
  conversionValues: number[],
  data: DailyDataPoint[],
  config: HeadroomModelConfig,
  safetyCap: number,
): HeadroomEstimate {
  const maxAllowedSpend = currentDailySpend * safetyCap;

  // Average current daily conversions
  const avgConversions = conversionValues.reduce((a, b) => a + b, 0) / conversionValues.length;

  // Average current daily revenue (for ROAS)
  const revenueValues = data.filter((d) => d.revenue !== null).map((d) => d.revenue!);
  const avgRevenue =
    revenueValues.length > 0
      ? revenueValues.reduce((a, b) => a + b, 0) / revenueValues.length
      : null;

  // Find optimal spend level
  let optimalSpend = maxAllowedSpend;

  if (config.targetCPA !== undefined) {
    // Binary search for the spend level where CPA = targetCPA
    optimalSpend = findCPAThreshold(model, config.targetCPA, currentDailySpend, maxAllowedSpend);
  } else if (config.targetROAS !== undefined && avgRevenue !== null && avgConversions > 0) {
    // Estimate AOV and find ROAS threshold
    const aov = avgRevenue / avgConversions;
    optimalSpend = findROASThreshold(
      model,
      config.targetROAS,
      aov,
      currentDailySpend,
      maxAllowedSpend,
    );
  } else {
    // No target — default to max safety cap
    optimalSpend = maxAllowedSpend;
  }

  const predictedConv = predictConversions(model, optimalSpend);
  const predictedCPA = predictedConv > 0 ? optimalSpend / predictedConv : null;

  let predictedROAS: number | null = null;
  if (avgRevenue !== null && avgConversions > 0) {
    const aov = avgRevenue / avgConversions;
    const predictedRevenue = predictedConv * aov;
    predictedROAS = optimalSpend > 0 ? predictedRevenue / optimalSpend : null;
  }

  const headroomPercent =
    currentDailySpend > 0 ? ((optimalSpend - currentDailySpend) / currentDailySpend) * 100 : 0;

  return {
    currentDailySpend,
    recommendedDailySpend: optimalSpend,
    headroomPercent: Math.max(0, headroomPercent),
    predictedConversions: predictedConv,
    predictedCPA,
    predictedROAS,
  };
}

/**
 * Binary search for the spend level where predicted CPA equals targetCPA.
 * CPA = spend / predictConversions(model, spend)
 */
function findCPAThreshold(
  model: FittedCurve,
  targetCPA: number,
  currentSpend: number,
  maxSpend: number,
): number {
  let low = currentSpend;
  let high = maxSpend;

  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    const conversions = predictConversions(model, mid);
    if (conversions <= 0) {
      high = mid;
      continue;
    }
    const cpa = mid / conversions;

    if (cpa < targetCPA) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * Binary search for the spend level where predicted ROAS equals targetROAS.
 * ROAS = (predictedConversions * AOV) / spend
 */
function findROASThreshold(
  model: FittedCurve,
  targetROAS: number,
  aov: number,
  currentSpend: number,
  maxSpend: number,
): number {
  let low = currentSpend;
  let high = maxSpend;

  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    const conversions = predictConversions(model, mid);
    const roas = mid > 0 ? (conversions * aov) / mid : 0;

    if (roas > targetROAS) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

// ---------------------------------------------------------------------------
// Bootstrap confidence bands
// ---------------------------------------------------------------------------

function bootstrapConfidenceBand(
  data: DailyDataPoint[],
  weights: number[],
  modelType: ModelType,
  currentDailySpend: number,
  config: HeadroomModelConfig,
  safetyCap: number,
  nSamples: number,
): ConfidenceBand {
  const headroomSamples: number[] = [];

  for (let s = 0; s < nSamples; s++) {
    // Resample with replacement (weighted by time-decay)
    const sample = weightedResample(data, weights);
    const spendValues = sample.map((d) => d.spend);
    const convValues = sample.map((d) => d.conversions);
    const uniformWeights = new Array(sample.length).fill(1);

    const model =
      modelType === "logarithmic"
        ? fitLogModel(spendValues, convValues, uniformWeights)
        : fitPowerModel(spendValues, convValues, uniformWeights);

    const estimate = computeHeadroomEstimate(
      model,
      currentDailySpend,
      convValues,
      sample,
      config,
      safetyCap,
    );
    headroomSamples.push(estimate.headroomPercent);
  }

  headroomSamples.sort((a, b) => a - b);

  return {
    lowerPercent: percentile(headroomSamples, 10),
    upperPercent: percentile(headroomSamples, 90),
  };
}

/**
 * Weighted resampling with replacement.
 * Uses a simple alias-free approach for clarity.
 */
function weightedResample(data: DailyDataPoint[], weights: number[]): DailyDataPoint[] {
  const n = data.length;
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const cumWeights: number[] = [];
  let cumSum = 0;
  for (let i = 0; i < n; i++) {
    cumSum += weights[i]! / totalWeight;
    cumWeights.push(cumSum);
  }

  const sample: DailyDataPoint[] = [];
  for (let i = 0; i < n; i++) {
    const r = seededRandom(i + n * 31);
    const idx = cumWeights.findIndex((cw) => r <= cw);
    sample.push(data[idx !== -1 ? idx : n - 1]!);
  }

  return sample;
}

/**
 * Deterministic pseudo-random for reproducible bootstraps.
 * Returns a value in [0, 1).
 */
function seededRandom(seed: number): number {
  // Simple xorshift32
  let x = seed | 1;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return Math.abs(x % 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Caveats generator
// ---------------------------------------------------------------------------

function generateCaveats(
  dq: DataQualityReport,
  confidence: ConfidenceTier,
  model: FittedCurve,
): string[] {
  const caveats: string[] = [];

  if (confidence === "low") {
    caveats.push(
      `Low model confidence (R²=${model.rSquared.toFixed(2)}). The spend-conversion relationship is weak — treat this estimate as directional only.`,
    );
  } else if (confidence === "medium") {
    caveats.push(
      `Medium model confidence (R²=${model.rSquared.toFixed(2)}). Recommendation has moderate uncertainty — consider the confidence band range.`,
    );
  }

  if (dq.lowVariability) {
    caveats.push(
      `Spend variability is low (CV=${dq.spendCV.toFixed(2)}). The model works best with diverse spend levels. Consider a budget test period with varied daily spend.`,
    );
  }

  if (dq.seasonalBoundary) {
    caveats.push(
      `Data period spans a seasonal event (${dq.seasonalEventName}). CPMs and conversion rates during this period may not reflect normal performance. Re-run on a non-seasonal window for a more reliable estimate.`,
    );
  }

  if (dq.gapDays > 3) {
    caveats.push(
      `${dq.gapDays} zero-spend days detected. Gaps may indicate paused campaigns — the model only reflects active-spend behavior.`,
    );
  }

  if (dq.outliersRemoved > dq.cleanPointCount * 0.15) {
    caveats.push(
      `${dq.outliersRemoved} outlier days removed (>${((dq.outliersRemoved / (dq.cleanPointCount + dq.outliersRemoved)) * 100).toFixed(0)}% of data). Verify that removed days weren't valid seasonal peaks or intentional budget tests.`,
    );
  }

  return caveats;
}

// ---------------------------------------------------------------------------
// Confidence classification
// ---------------------------------------------------------------------------

export function classifyConfidence(rSquared: number): ConfidenceTier {
  if (rSquared >= R_SQUARED_HIGH) return "high";
  if (rSquared >= R_SQUARED_MEDIUM) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower]!;
  const frac = idx - lower;
  return sorted[lower]! * (1 - frac) + sorted[upper]! * frac;
}

function weightedMean(values: number[], weights: number[]): number {
  let sumWV = 0;
  let sumW = 0;
  for (let i = 0; i < values.length; i++) {
    sumWV += values[i]! * weights[i]!;
    sumW += weights[i]!;
  }
  return sumW > 0 ? sumWV / sumW : 0;
}
