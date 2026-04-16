// packages/core/src/creative-pipeline/ugc/ugc-director.ts

// ── Types ──

interface CreatorDirectionInput {
  personality: { energy: string; deliveryStyle: string };
  appearanceRules: {
    hairStates: string[];
    wardrobePalette: string[];
  };
  environmentSet: string[];
}

interface StructureDirectionInput {
  id: string;
  name: string;
  sections: Array<{ name: string; purposeGuide: string; durationRange: [number, number] }>;
}

export interface DirectionInput {
  creator: CreatorDirectionInput;
  structure: StructureDirectionInput;
  platform: string;
  ugcFormat: string;
}

export interface SceneStyle {
  lighting: "natural" | "ambient" | "golden_hour" | "overcast" | "ring_light";
  cameraAngle: "selfie" | "eye_level" | "slight_low" | "over_shoulder";
  cameraMovement: "handheld" | "static_tripod" | "slow_pan" | "none";
  environment: string;
  wardrobeSelection: string[];
  hairState: string;
  props: string[];
}

export interface UgcDirection {
  hookType: "direct_camera" | "mid_action" | "reaction" | "text_overlay_start";
  eyeContact: "camera" | "off_camera" | "mixed";
  energyLevel: "low" | "medium" | "high";
  pacingNotes: string;
  imperfections: {
    hesitationDensity: number;
    sentenceRestartRate: number;
    microPauseDensity: number;
    fillerDensityTarget: number;
    fragmentationTarget: number;
  };
  adLibPermissions: string[];
  forbiddenFraming: string[];
}

export interface DirectionOutput {
  sceneStyle: SceneStyle;
  ugcDirection: UgcDirection;
}

// ── Deterministic selection helpers ──

function pickFrom<T>(arr: T[], seed: number = 0): T {
  if (arr.length === 0) {
    throw new Error("Cannot pick from empty array");
  }
  const selected = arr[seed % arr.length];
  if (selected === undefined) {
    throw new Error("Unexpected undefined in array");
  }
  return selected;
}

// ── Energy mapping ──

function mapEnergy(energy: string): "low" | "medium" | "high" {
  switch (energy) {
    case "calm":
      return "low";
    case "conversational":
      return "medium";
    case "energetic":
      return "high";
    case "intense":
      return "high";
    default:
      return "medium";
  }
}

// ── UGC-native lighting (never studio) ──

const UGC_LIGHTING: Array<"natural" | "ambient" | "golden_hour" | "overcast"> = [
  "natural",
  "ambient",
  "golden_hour",
  "overcast",
];

// ── Camera mapping by format ──

function getCameraAngle(format: string): SceneStyle["cameraAngle"] {
  switch (format) {
    case "talking_head":
      return "selfie";
    case "lifestyle":
      return "eye_level";
    case "product_in_hand":
      return "slight_low";
    case "multi_shot":
      return "eye_level";
    default:
      return "eye_level";
  }
}

function getCameraMovement(format: string): SceneStyle["cameraMovement"] {
  switch (format) {
    case "talking_head":
      return "handheld";
    case "lifestyle":
      return "slow_pan";
    case "product_in_hand":
      return "handheld";
    case "multi_shot":
      return "handheld";
    default:
      return "handheld";
  }
}

// ── Hook type by structure ──

function getHookType(structureId: string): UgcDirection["hookType"] {
  switch (structureId) {
    case "confession":
    case "social_proof":
      return "direct_camera";
    case "demo_first":
    case "before_after":
      return "mid_action";
    case "myth_buster":
    case "mistake":
      return "reaction";
    default:
      return "direct_camera";
  }
}

// ── Default imperfection profile ──

const DEFAULT_IMPERFECTIONS = {
  hesitationDensity: 0.15,
  sentenceRestartRate: 0.1,
  microPauseDensity: 0.2,
  fillerDensityTarget: 0.2,
  fragmentationTarget: 0.3,
};

/**
 * Generates SceneStyle and UGCDirection from creator bible + structure.
 * Pure function — no LLM calls, fully deterministic.
 */
export function generateDirection(input: DirectionInput): DirectionOutput {
  const { creator, structure, ugcFormat } = input;

  const sceneStyle: SceneStyle = {
    lighting: pickFrom(UGC_LIGHTING),
    cameraAngle: getCameraAngle(ugcFormat),
    cameraMovement: getCameraMovement(ugcFormat),
    environment: pickFrom(creator.environmentSet),
    wardrobeSelection: creator.appearanceRules.wardrobePalette.slice(0, 2),
    hairState: pickFrom(creator.appearanceRules.hairStates),
    props: [],
  };

  const ugcDirection: UgcDirection = {
    hookType: getHookType(structure.id),
    eyeContact: ugcFormat === "talking_head" ? "camera" : "mixed",
    energyLevel: mapEnergy(creator.personality.energy),
    pacingNotes: `Match ${creator.personality.deliveryStyle} delivery style`,
    imperfections: DEFAULT_IMPERFECTIONS,
    adLibPermissions: ["natural reactions", "brief asides"],
    forbiddenFraming: [
      "no studio lighting",
      "no centered framing",
      "no professional backdrop",
      "no teleprompter eye movement",
    ],
  };

  return { sceneStyle, ugcDirection };
}
