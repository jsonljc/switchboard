// Direction-faithful UGC video requests (slice-3 spec 3.2).
//
// Scripting computes SceneStyle + UgcDirection for every spec and attaches
// them as `style` / `direction`; production previously discarded both and
// prompted with raw script text. This module composes them into the provider
// request: prompt text (scene + direction + authenticity cues), negative
// prompt (forbiddenFraming + the standard artifact suffix), camera motion
// (mapped only where the provider vocabulary supports it; otherwise the
// prompt TEXT carries the style cue), and the optional reference image.
// Pure and deterministic; absent or unparseable style/direction falls back
// to the raw script text, byte-equal to the legacy prompt.
import { SceneStyleSchema, UgcDirectionSchema } from "@switchboard/schemas";
import type { VideoGenerationRequest } from "./video-provider.js";

interface SpecForPrompt {
  script: { text: string; language: string };
  style?: unknown;
  direction?: unknown;
  renderTargets: { aspect: string; durationSec: number };
  referenceImageUrl?: string;
  /** Avatar refs attached at scripting (slice-3 spec 3.5). */
  creator?: { heygenAvatarId?: string; heygenVoiceId?: string };
}

const STANDARD_NEGATIVE = "blurry, low quality, distorted, watermark, text artifacts";

/** Provider camera vocabulary (kling camera_control): map what exists, drop the rest. */
const CAMERA_MOTION_MAP: Record<string, string | undefined> = {
  slow_pan: "pan_right",
  handheld: undefined, // no provider equivalent; the prompt text carries it
  static_tripod: undefined,
  none: undefined,
};

const CAMERA_TEXT: Record<string, string> = {
  handheld: "handheld camera",
  static_tripod: "static tripod shot",
  slow_pan: "slow panning shot",
  none: "fixed framing",
};

const EYE_CONTACT_TEXT: Record<string, string> = {
  camera: "looking at the camera",
  off_camera: "looking off camera",
  mixed: "mixed eye contact",
};

function words(value: string): string {
  return value.replace(/_/g, " ");
}

export function buildUgcVideoRequest(spec: SpecForPrompt): VideoGenerationRequest {
  const styleParsed = SceneStyleSchema.safeParse(spec.style);
  const directionParsed = UgcDirectionSchema.safeParse(spec.direction);

  const base: VideoGenerationRequest = {
    prompt: spec.script.text,
    // The SPOKEN script rides separately (slice-3 spec 3.5): avatar providers
    // read it aloud; the composed prompt below is visual-generation text.
    script: spec.script.text,
    durationSec: spec.renderTargets.durationSec,
    aspectRatio: spec.renderTargets.aspect,
    ...(spec.referenceImageUrl ? { referenceImageUrl: spec.referenceImageUrl } : {}),
    ...(spec.creator?.heygenAvatarId
      ? {
          avatar: {
            refId: spec.creator.heygenAvatarId,
            ...(spec.creator.heygenVoiceId ? { voiceId: spec.creator.heygenVoiceId } : {}),
          },
        }
      : {}),
  };

  if (!styleParsed.success && !directionParsed.success) {
    // Legacy fallback: exactly the raw-script prompt production sent before.
    return base;
  }

  const parts: string[] = [spec.script.text];

  if (styleParsed.success) {
    const s = styleParsed.data;
    const wardrobe =
      s.wardrobeSelection.length > 0 ? `, wearing ${s.wardrobeSelection.join(" and ")}` : "";
    parts.push(
      `Scene: ${words(s.lighting)} lighting, ${words(s.cameraAngle)} angle, ` +
        `${CAMERA_TEXT[s.cameraMovement] ?? words(s.cameraMovement)}, in ${s.environment}` +
        `${wardrobe}, ${s.hairState} hair.`,
    );
  }

  if (directionParsed.success) {
    const d = directionParsed.data;
    parts.push(
      `Delivery: ${d.energyLevel} energy, ${EYE_CONTACT_TEXT[d.eyeContact] ?? words(d.eyeContact)}. ` +
        `${d.pacingNotes}.`,
    );
    // Fixed authenticity cue, emitted whenever an imperfection profile is
    // present: real UGC reads unpolished. The exact densities stay a
    // scripting concern; the prompt never varies by them.
    parts.push("Authentic creator feel: natural pauses and small restarts, unpolished delivery.");
  }

  const forbidden = directionParsed.success ? directionParsed.data.forbiddenFraming : [];
  const negativePrompt =
    forbidden.length > 0 ? `${forbidden.join(", ")}, ${STANDARD_NEGATIVE}` : STANDARD_NEGATIVE;

  const cameraMotion = styleParsed.success
    ? CAMERA_MOTION_MAP[styleParsed.data.cameraMovement]
    : undefined;

  return {
    ...base,
    prompt: parts.join(" "),
    negativePrompt,
    ...(cameraMotion ? { cameraMotion } : {}),
  };
}
