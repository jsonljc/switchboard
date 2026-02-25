/**
 * Prompt injection detection: scans raw LLM output and user input
 * for known injection patterns before schema guard.
 */

const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, label: "ignore_previous" },
  { pattern: /disregard\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|rules)/i, label: "disregard_instructions" },
  { pattern: /you\s+are\s+now\s+(a|an|in)\s+/i, label: "role_override" },
  { pattern: /system\s*:\s*/i, label: "system_prompt_injection" },
  { pattern: /\[INST\]/i, label: "instruction_tag" },
  { pattern: /<\|im_start\|>/i, label: "chatml_injection" },
  { pattern: /<<SYS>>/i, label: "llama_system_injection" },
  { pattern: /do\s+not\s+follow\s+(your|the)\s+(rules|guidelines|instructions)/i, label: "rule_override" },
  { pattern: /pretend\s+(you\s+are|to\s+be|that)/i, label: "pretend_override" },
  { pattern: /forget\s+(everything|all|your)\s+(you|instructions|rules)/i, label: "forget_instructions" },
  { pattern: /new\s+instructions?\s*:/i, label: "new_instructions" },
  { pattern: /override\s+(the\s+)?(system|safety|rules)/i, label: "override_system" },
  // Encoding-based evasion
  { pattern: /\bbase64\s*[:(]/i, label: "base64_reference" },
  { pattern: /\batob\s*\(/i, label: "base64_decode_call" },
  // Zero-width and invisible character obfuscation
  { pattern: /[\u200B\u200C\u200D\uFEFF\u2060\u00AD]/, label: "zero_width_chars" },
  // Tool/function output exploitation
  { pattern: /\btool_result\b/i, label: "tool_result_injection" },
  { pattern: /\bfunction_call\b/i, label: "function_call_injection" },
];

/**
 * Unicode homoglyph ranges: Cyrillic, Greek, and other scripts that contain
 * characters visually similar to Latin letters. These can be used to evade
 * keyword-based injection patterns (e.g., Cyrillic "а" vs Latin "a").
 */
const HOMOGLYPH_RANGES = [
  /[\u0400-\u04FF]/, // Cyrillic
  /[\u0370-\u03FF]/, // Greek
  /[\u2100-\u214F]/, // Letterlike symbols (e.g., ℝ, ℕ)
  /[\uFF01-\uFF5E]/, // Fullwidth ASCII variants
];

/**
 * Detect mixed-script text that may indicate homoglyph-based evasion.
 * Returns true if the input contains Latin characters mixed with characters
 * from Cyrillic, Greek, or other confusable script ranges.
 */
function detectHomoglyphMixing(input: string): boolean {
  const hasLatin = /[a-zA-Z]/.test(input);
  if (!hasLatin) return false;
  return HOMOGLYPH_RANGES.some((range) => range.test(input));
}

/**
 * Detect base64-encoded injection payloads embedded in the input.
 * Looks for base64 strings that decode to known injection patterns.
 */
function detectBase64Injection(input: string): boolean {
  // Match base64-like strings (min 20 chars to avoid false positives on short tokens)
  const base64Pattern = /[A-Za-z0-9+/]{20,}={0,2}/g;
  let match: RegExpExecArray | null;
  while ((match = base64Pattern.exec(input)) !== null) {
    try {
      const decoded = Buffer.from(match[0], "base64").toString("utf-8");
      // Check if decoded content contains injection patterns
      if (/ignore.*previous|system\s*:|new\s+instructions/i.test(decoded)) {
        return true;
      }
    } catch {
      // Not valid base64 — skip
    }
  }
  return false;
}

export interface InjectionDetectionResult {
  detected: boolean;
  patterns: string[];
  rawInput: string;
}

export function detectPromptInjection(input: string): InjectionDetectionResult {
  const matched: string[] = [];

  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      matched.push(label);
    }
  }

  if (detectHomoglyphMixing(input)) {
    matched.push("homoglyph_mixing");
  }

  if (detectBase64Injection(input)) {
    matched.push("base64_encoded_injection");
  }

  return {
    detected: matched.length > 0,
    patterns: matched,
    rawInput: input,
  };
}

export function detectPromptInjectionInOutput(llmOutput: string): InjectionDetectionResult {
  return detectPromptInjection(llmOutput);
}
