import { z } from "zod";
import {
  CreativeBriefInput,
  type CreativeBriefInput as CreativeBriefInputType,
} from "./creative-job.js";

// Two optional chips with defaults (spec / decided UX). The owner gives intent
// and taste — never platforms or tooling.
export const MiraBriefGoal = z.enum(["more_bookings", "fill_slow_days", "new_treatment", "brand"]);
export type MiraBriefGoal = z.infer<typeof MiraBriefGoal>;

export const MiraBriefVibe = z.enum(["warm", "luxe", "fun", "clinical"]);
export type MiraBriefVibe = z.infer<typeof MiraBriefVibe>;

// The hybrid brief: ONE required line + two optional chips. Reference/asset
// upload is intentionally deferred in Phase 2.
// `mode` (slice-3 spec 3.4): the format toggle. Wire name matches the
// pipeline's SubmitBriefInput.mode; the desk renders it as Polished/Real-talk.
export const MiraBriefRequestSchema = z.object({
  promoting: z.string().min(1).max(500),
  goal: MiraBriefGoal.default("more_bookings"),
  vibe: MiraBriefVibe.default("warm"),
  mode: z.enum(["polished", "ugc"]).default("polished"),
});
export type MiraBriefRequest = z.infer<typeof MiraBriefRequestSchema>;

// Wire result of createCreativeDraftRequest (the Phase-2 open-brief contract).
export interface MiraBriefResult {
  jobId: string;
  status: "brief_submitted";
  expectedDraftCount: number;
  cost: { upfront: number | null; generationGatedInReview: boolean };
  requestSource: "mira.open_brief";
}

const GOAL_OBJECTIVE: Record<MiraBriefGoal, string> = {
  more_bookings: "drive bookings",
  fill_slow_days: "fill slower days",
  new_treatment: "introduce a new treatment",
  brand: "build brand awareness",
};

const VIBE_VOICE: Record<MiraBriefVibe, string> = {
  warm: "Warm and trustworthy",
  luxe: "Elevated and luxe",
  fun: "Playful and fun",
  clinical: "Clear and clinical",
};

const DEFAULT_AUDIENCE = "Local prospects interested in aesthetic treatments";

/**
 * Map the lightweight Desk brief into the pipeline's CreativeBriefInput. The
 * brief shape is mode-agnostic; `mode` rides the request separately into the
 * ingress params. Accepts the schema INPUT type so defaulted fields stay
 * optional for callers.
 */
export function mapMiraBriefToCreativeBrief(
  input: z.input<typeof MiraBriefRequestSchema>,
): CreativeBriefInputType {
  const brief = MiraBriefRequestSchema.parse(input); // applies chip defaults
  return CreativeBriefInput.parse({
    productDescription: `${brief.promoting.trim()} — ${GOAL_OBJECTIVE[brief.goal]}`,
    targetAudience: DEFAULT_AUDIENCE,
    platforms: ["meta"],
    brandVoice: VIBE_VOICE[brief.vibe],
    references: [],
    productImages: [],
    generateReferenceImages: false,
  });
}

// Off-scope guard: the brief box NEVER answers QUESTIONS about scheduling or
// results — Mira makes ad creative; the front office (Alex) and reporting own
// those. The Intent Preview uses this to redirect instead of submitting.
//
// We require BOTH a scheduling/results TOPIC and a QUESTION shape, so ordinary
// creative briefs that merely mention bookings/appointments as the thing being
// promoted ("Book now — Botox from $11", "Promote online booking", "New
// appointment slots — drive new clients") are NOT misclassified. Only an actual
// question ("When can I rebook my 3pm?", "How much revenue did the ad make?")
// trips the redirect. Topic words are the unambiguous front-office / reporting
// concerns — NOT "book"/"lead", which are common ad CTAs.
const OFF_SCOPE_TOPIC =
  /\b(rebook|reschedul|cancel|appointment|availab|results?|roi|roas|revenue|spend|report|refund|invoice|payment)\b/i;
const QUESTION_SHAPE =
  /\?|\b(how|when|what|why|where|who|which|can|could|did|do|does|is|are|was|were|will|should)\b/i;

export function classifyBriefIntent(promoting: string): "creative" | "off_scope" {
  return OFF_SCOPE_TOPIC.test(promoting) && QUESTION_SHAPE.test(promoting)
    ? "off_scope"
    : "creative";
}
