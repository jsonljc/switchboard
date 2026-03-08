// ---------------------------------------------------------------------------
// Best Practices Engine — Performance 5 enforcement
// ---------------------------------------------------------------------------

import type { Performance5Assessment } from "./types.js";

export interface AccountData {
  campaignCount: number;
  adSetCount: number;
  adCount: number;
  uniqueCreativeFormats: number;
  hasCapiEnabled: boolean;
  hasAdvantageCreative: boolean;
  hasAdvantagePlacements: boolean;
  hasASC: boolean;
  hasConversionLiftStudy: boolean;
  avgCreativesPerAdSet: number;
}

export class BestPracticesEngine {
  assess(data: AccountData): Performance5Assessment {
    const accountSimplification = this.assessSimplification(data);
    const advantagePlus = this.assessAdvantagePlus(data);
    const creativeDiversification = this.assessCreativeDiversification(data);
    const conversionsAPI = this.assessCAPI(data);
    const resultsValidation = this.assessValidation(data);

    const overallScore = Math.round(
      (accountSimplification.score +
        advantagePlus.score +
        creativeDiversification.score +
        conversionsAPI.score +
        resultsValidation.score) / 5
    );

    return {
      accountSimplification,
      advantagePlus,
      creativeDiversification,
      conversionsAPI,
      resultsValidation,
      overallScore,
    };
  }

  private assessSimplification(data: AccountData) {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    const ratio = data.adSetCount / Math.max(1, data.campaignCount);
    if (ratio > 10) {
      score -= 40;
      issues.push(`High ad set to campaign ratio (${ratio.toFixed(0)}:1)`);
      recommendations.push("Consolidate ad sets — aim for 3-5 per campaign");
    } else if (ratio > 5) {
      score -= 20;
      issues.push(`Above-average ad set count (${ratio.toFixed(0)} per campaign)`);
      recommendations.push("Review ad sets for consolidation opportunities");
    }

    if (data.campaignCount > 20) {
      score -= 20;
      issues.push(`${data.campaignCount} campaigns — consider consolidation`);
      recommendations.push("Merge campaigns with same objective and audience");
    }

    return { score: Math.max(0, score), issues, recommendations };
  }

  private assessAdvantagePlus(data: AccountData) {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    if (!data.hasAdvantageCreative) {
      score -= 30;
      issues.push("Advantage+ Creative not enabled");
      recommendations.push("Enable Advantage+ Creative for automated creative optimization");
    }
    if (!data.hasAdvantagePlacements) {
      score -= 30;
      issues.push("Advantage+ Placements not enabled");
      recommendations.push("Enable Advantage+ Placements for broader delivery");
    }
    if (!data.hasASC) {
      score -= 20;
      issues.push("No Advantage+ Shopping Campaigns detected");
      recommendations.push("Test ASC for e-commerce accounts");
    }

    return { score: Math.max(0, score), issues, recommendations };
  }

  private assessCreativeDiversification(data: AccountData) {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    if (data.avgCreativesPerAdSet < 3) {
      score -= 40;
      issues.push(`Only ${data.avgCreativesPerAdSet.toFixed(1)} creatives per ad set (minimum 3 recommended)`);
      recommendations.push("Add more creative variants to each ad set");
    }
    if (data.uniqueCreativeFormats < 2) {
      score -= 30;
      issues.push("Only one creative format in use");
      recommendations.push("Diversify with video, carousel, and collection formats");
    }

    return { score: Math.max(0, score), issues, recommendations };
  }

  private assessCAPI(data: AccountData) {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = data.hasCapiEnabled ? 100 : 0;

    if (!data.hasCapiEnabled) {
      issues.push("Conversions API not detected");
      recommendations.push("Implement server-side event tracking via Conversions API");
      recommendations.push("This improves event matching, attribution accuracy, and optimization");
    }

    return { score, issues, recommendations };
  }

  private assessValidation(data: AccountData) {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = data.hasConversionLiftStudy ? 100 : 30;

    if (!data.hasConversionLiftStudy) {
      issues.push("No conversion lift study detected");
      recommendations.push("Run a conversion lift study to validate true incremental impact");
    }

    return { score, issues, recommendations };
  }
}
