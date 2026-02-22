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
];

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

  return {
    detected: matched.length > 0,
    patterns: matched,
    rawInput: input,
  };
}

export function detectPromptInjectionInOutput(llmOutput: string): InjectionDetectionResult {
  return detectPromptInjection(llmOutput);
}
