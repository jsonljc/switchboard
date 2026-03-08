// ---------------------------------------------------------------------------
// Creative Rotation Engine — Automated creative rotation logic
// ---------------------------------------------------------------------------

export interface RotationPlan {
  toPause: Array<{ adId: string; reason: string }>;
  toActivate: Array<{ adId: string; reason: string }>;
  toKeep: Array<{ adId: string; reason: string }>;
  summary: string;
}

export interface AdPerformance {
  adId: string;
  adName: string;
  status: "ACTIVE" | "PAUSED";
  spend: number;
  impressions: number;
  conversions: number;
  cpa: number | null;
  ctr: number;
  frequency: number;
  fatigueScore: number;
}

export class CreativeRotationEngine {
  generatePlan(ads: AdPerformance[], options?: { minSpendThreshold?: number }): RotationPlan {
    const minSpend = options?.minSpendThreshold ?? 10;

    const toPause: RotationPlan["toPause"] = [];
    const toActivate: RotationPlan["toActivate"] = [];
    const toKeep: RotationPlan["toKeep"] = [];

    const activeAds = ads.filter((a) => a.status === "ACTIVE");
    const pausedAds = ads.filter((a) => a.status === "PAUSED");

    const activeCPAs = activeAds
      .filter((a) => a.cpa !== null && a.spend >= minSpend)
      .map((a) => a.cpa!);
    activeCPAs.sort((a, b) => a - b);
    const medianCPA = activeCPAs.length > 0 ? activeCPAs[Math.floor(activeCPAs.length / 2)]! : null;

    for (const ad of activeAds) {
      if (ad.fatigueScore > 0.8) {
        toPause.push({
          adId: ad.adId,
          reason: `Creative fatigue score ${ad.fatigueScore.toFixed(2)} (frequency: ${ad.frequency.toFixed(1)})`,
        });
      } else if (ad.spend >= minSpend && ad.conversions === 0) {
        toPause.push({
          adId: ad.adId,
          reason: `Zero conversions after $${ad.spend.toFixed(2)} spend`,
        });
      } else if (medianCPA !== null && ad.cpa !== null && ad.cpa > medianCPA * 2) {
        toPause.push({
          adId: ad.adId,
          reason: `CPA ($${ad.cpa.toFixed(2)}) is 2x+ median ($${medianCPA.toFixed(2)})`,
        });
      } else {
        toKeep.push({
          adId: ad.adId,
          reason: "Performing within acceptable range",
        });
      }
    }

    if (toPause.length > 0 && pausedAds.length > 0) {
      const toActivateCount = Math.min(toPause.length, pausedAds.length);
      for (let i = 0; i < toActivateCount; i++) {
        toActivate.push({
          adId: pausedAds[i]!.adId,
          reason: "Replacing paused fatigued/underperforming creative",
        });
      }
    }

    const summary = `Rotation plan: pause ${toPause.length}, activate ${toActivate.length}, keep ${toKeep.length} of ${ads.length} total ads`;

    return { toPause, toActivate, toKeep, summary };
  }

  async execute(
    plan: RotationPlan,
    updateAdStatus: (adId: string, status: "ACTIVE" | "PAUSED") => Promise<void>,
  ): Promise<{ pausedCount: number; activatedCount: number; errors: string[] }> {
    const errors: string[] = [];
    let pausedCount = 0;
    let activatedCount = 0;

    for (const { adId } of plan.toPause) {
      try {
        await updateAdStatus(adId, "PAUSED");
        pausedCount++;
      } catch (err) {
        errors.push(`Failed to pause ${adId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    for (const { adId } of plan.toActivate) {
      try {
        await updateAdStatus(adId, "ACTIVE");
        activatedCount++;
      } catch (err) {
        errors.push(
          `Failed to activate ${adId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { pausedCount, activatedCount, errors };
  }
}
