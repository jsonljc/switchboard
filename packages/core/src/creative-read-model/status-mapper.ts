import type { CreativeJob } from "@switchboard/schemas";
import type { MiraCreativeStatus, MiraReviewAction, MiraCreativeDraft } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function productionErrorsWithoutVideo(stageOutputs: unknown): boolean {
  const production = asRecord(asRecord(stageOutputs).production);
  const errors = production.errors;
  const assembled = production.assembledVideos;
  const hasErrors = Array.isArray(errors) && errors.length > 0;
  const hasVideo = Array.isArray(assembled) && assembled.length > 0;
  return hasErrors && !hasVideo;
}

export function mapCreativeJobToMiraStatus(job: CreativeJob): MiraCreativeStatus {
  if (job.mode === "ugc" && job.ugcFailure != null) return "failed";
  if (job.mode !== "ugc" && productionErrorsWithoutVideo(job.stageOutputs)) return "failed";
  if (job.stoppedAt != null) return "stopped";
  if (job.currentStage === "complete") return "draft_ready";
  const hasOutputs = Object.keys(asRecord(job.stageOutputs)).length > 0;
  return hasOutputs ? "awaiting_review" : "in_progress";
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
  const production = asRecord(asRecord(job.stageOutputs).production);
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
