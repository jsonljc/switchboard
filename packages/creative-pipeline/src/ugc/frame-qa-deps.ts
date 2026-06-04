// Live wiring for the frame-QA evaluator (slice-3 spec 3.1): the production
// phase self-constructs its QA capabilities from the api key it already holds.
// Isolated in this module so tests can mock the factory and so a future
// refactor cannot silently drop the wiring back to the honest stub.
import { FfmpegFrameExtractor } from "./frame-extractor.js";
import { callClaudeWithImages } from "../stages/call-claude.js";
import type { RealismScorerDeps } from "./realism-scorer.js";

const QA_SYSTEM_PROMPT =
  "You are a meticulous technical video QA inspector. Respond with JSON only.";
const QA_MAX_TOKENS = 1024;

/**
 * Build the evaluator deps from the phase's Anthropic api key. Empty key
 * (unconfigured dev) returns undefined: evaluateRealism stays the honest stub
 * and every asset routes to human review. The extractor reads the SSRF
 * allowlist from env (CREATIVE_PIPELINE_ALLOWED_HOSTS).
 */
export function buildFrameQaDeps(apiKey: string): RealismScorerDeps | undefined {
  if (!apiKey) return undefined;
  const frameExtractor = new FfmpegFrameExtractor();
  return {
    frameExtractor,
    vision: (opts) =>
      callClaudeWithImages({
        apiKey,
        systemPrompt: QA_SYSTEM_PROMPT,
        userMessage: opts.userMessage,
        images: opts.images,
        schema: opts.schema,
        maxTokens: QA_MAX_TOKENS,
      }),
  };
}
