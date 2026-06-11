import { RealismScoreSchema, type CreativeJob } from "@switchboard/schemas";
import type {
  MiraCreativeStatus,
  MiraReviewAction,
  MiraCreativeDraft,
  MiraCreativeQa,
} from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasKeys(x: unknown): boolean {
  return Object.keys(asRecord(x)).length > 0;
}

function productionErrorsWithoutVideo(stageOutputs: unknown): boolean {
  const production = asRecord(asRecord(stageOutputs).production);
  const errors = production.errors;
  const assembled = production.assembledVideos;
  const hasErrors = Array.isArray(errors) && errors.length > 0;
  const hasVideo = Array.isArray(assembled) && assembled.length > 0;
  return hasErrors && !hasVideo;
}

/** UGC production assets, parsed defensively from the phase outputs JSON. */
function ugcProductionAssets(job: CreativeJob): Array<Record<string, unknown>> {
  const production = asRecord(asRecord(job.ugcPhaseOutputs).production);
  return Array.isArray(production.assets) ? production.assets.map((a) => asRecord(a)) : [];
}

/**
 * Slice-3 (spec 3.1 consumer 4): a UGC job whose production output exists and
 * whose FINAL assets are ALL rejected reads as failed. This includes the
 * production-gate wait (ugcPhase "delivery"): the production-to-delivery
 * approve is intentionally pre-empted, an all-rejected batch has nothing
 * worth advancing.
 */
function allUgcAssetsRejected(job: CreativeJob): boolean {
  const assets = ugcProductionAssets(job);
  return assets.length > 0 && assets.every((a) => a.approvalState === "rejected");
}

export function mapCreativeJobToMiraStatus(job: CreativeJob): MiraCreativeStatus {
  // Rules 1–3: mode-agnostic failure and stop checks (all-rejected sits with
  // the failure rules so it beats a later timeout-stop)
  if (job.mode === "ugc" && (job.ugcFailure != null || allUgcAssetsRejected(job))) {
    return "failed";
  }
  if (job.mode !== "ugc" && productionErrorsWithoutVideo(job.stageOutputs)) return "failed";
  // Terminal failure marker written by the dead-letter consumer when a polished
  // render exhausts its retries; beats the awaiting_review fall-through below.
  if (job.mode !== "ugc" && job.stageFailure != null) return "failed";
  if (job.stoppedAt != null) return "stopped";

  // Rules 4–8: branch by mode for completion / progress detection
  if (job.mode === "ugc") {
    // UGC lifecycle keys off ugcPhase / ugcPhaseOutputs; currentStage stays at "trends" default
    if (job.ugcPhase === "complete") return "draft_ready";
    if (hasKeys(job.ugcPhaseOutputs)) return "awaiting_review";
    return "in_progress";
  }

  // Polished lifecycle keys off currentStage / stageOutputs
  if (job.currentStage === "complete") return "draft_ready";
  if (hasKeys(job.stageOutputs)) return "awaiting_review";
  return "in_progress";
}

export function deriveReviewAction(status: MiraCreativeStatus): MiraReviewAction {
  switch (status) {
    case "awaiting_review":
      return { canContinue: true, canStop: true, label: "continue_draft" };
    case "in_progress":
      return { canContinue: false, canStop: true, label: "none" };
    case "draft_ready":
      return { canContinue: false, canStop: false, label: "review_draft" };
    case "shipped":
    case "stopped":
    case "failed":
      return { canContinue: false, canStop: false, label: "none" };
  }
}

export function deriveTitle(job: CreativeJob): string {
  const t = (job.productDescription ?? "").trim();
  return t.length > 0 ? t : "Untitled creative";
}

export function deriveDraft(job: CreativeJob): MiraCreativeDraft | undefined {
  if (job.mode === "ugc") {
    return deriveUgcDraft(job.ugcPhaseOutputs);
  }
  return derivePolishedDraft(job.stageOutputs);
}

function derivePolishedDraft(stageOutputs: unknown): MiraCreativeDraft | undefined {
  const production = asRecord(asRecord(stageOutputs).production);
  const assembled = production.assembledVideos;
  if (Array.isArray(assembled) && assembled.length > 0) {
    const first = asRecord(assembled[0]);
    return {
      ...(typeof first.videoUrl === "string" ? { videoUrl: first.videoUrl } : {}),
      ...(typeof first.thumbnailUrl === "string" ? { thumbnailUrl: first.thumbnailUrl } : {}),
      ...(typeof first.duration === "number" ? { durationSec: first.duration } : {}),
    };
  }
  const clips = production.clips;
  if (Array.isArray(clips) && clips.length > 0) {
    const first = asRecord(clips[0]);
    if (typeof first.videoUrl === "string") return { videoUrl: first.videoUrl };
  }
  return undefined;
}

function deriveUgcDraft(ugcPhaseOutputs: unknown): MiraCreativeDraft | undefined {
  const phases = asRecord(ugcPhaseOutputs);

  // Prefer delivery phase video if present (delivery phase output is a no-op stub in SP2,
  // but may carry a finalVideoUrl in later SPs)
  const delivery = asRecord(phases.delivery);
  if (typeof delivery.videoUrl === "string") {
    return {
      videoUrl: delivery.videoUrl,
      ...(typeof delivery.thumbnailUrl === "string" ? { thumbnailUrl: delivery.thumbnailUrl } : {}),
      ...(typeof delivery.duration === "number" ? { durationSec: delivery.duration } : {}),
    };
  }

  // Fall back to production phase: the first NON-REJECTED asset (slice-3
  // frame QA), or assets[0] when every asset is rejected so the operator can
  // still see what failed.
  // (production output shape: { assets: AssetRecordOutput[], qaResults, failedSpecs })
  // AssetRecordOutput.outputs = { videoUrl, checksums }
  const production = asRecord(phases.production);
  const assets = production.assets;
  if (Array.isArray(assets) && assets.length > 0) {
    const records = assets.map((a) => asRecord(a));
    const chosen = records.find((a) => a.approvalState !== "rejected") ?? records[0]!;
    const outputs = asRecord(chosen.outputs);
    if (typeof outputs.videoUrl === "string") {
      return {
        videoUrl: outputs.videoUrl,
        ...(typeof chosen.duration === "number" ? { durationSec: chosen.duration } : {}),
      };
    }
  }

  return undefined;
}

/**
 * Slice-3 desk verdict (spec 3.1 consumer 3): the draft-chosen UGC asset's
 * frame-QA status + decision, parsed defensively from its persisted
 * `qaMetrics`. Absent for polished jobs and for unparseable rows; the line
 * is technical QA, never taste.
 */
export function deriveQa(job: CreativeJob): MiraCreativeQa | undefined {
  if (job.mode !== "ugc") return undefined;
  const assets = ugcProductionAssets(job);
  if (assets.length === 0) return undefined;
  const chosen = assets.find((a) => a.approvalState !== "rejected") ?? assets[0]!;
  const parsed = RealismScoreSchema.safeParse(chosen.qaMetrics);
  if (!parsed.success) return undefined;
  return { status: parsed.data.qaStatus, decision: parsed.data.overallDecision };
}
