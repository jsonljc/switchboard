import type { DialogueStage } from "../model-router.js";
import type { EmotionalSignal } from "./types.js";

/**
 * Derive a coarse dialogue stage from an emotional signal, used by the model
 * router to raise the tier on high-stakes turns. Precedence is
 * fear → closing → objection (first match wins); `undefined` means "no
 * escalating signal — let the previous-turn rules decide".
 *
 * Pure and deterministic — no I/O. The `fear` branch is bounded by the
 * classifier's own concern precedence (price > trust > timing > fear), so a
 * price-laden message is classified `price` (→ objection) and never reaches
 * `fear`.
 */
export function emotionalSignalToStage(signal: EmotionalSignal): DialogueStage | undefined {
  if (signal.concernType === "fear") return "fear";
  if (signal.urgencySignal === "ready_now") return "closing";
  if (
    signal.concernType === "price" ||
    signal.concernType === "trust" ||
    signal.concernType === "timing" ||
    signal.concernType === "comparison"
  ) {
    return "objection";
  }
  return undefined;
}
