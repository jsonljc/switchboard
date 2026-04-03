import type { PersonalityConfig } from "./types.js";

export interface PersonalityPrompt {
  toPrompt: () => string;
}

export function compilePersonality(config: PersonalityConfig): PersonalityPrompt {
  return {
    toPrompt() {
      const traits = config.traits.length > 0 ? `\nKey traits: ${config.traits.join(", ")}.` : "";
      return `${config.role}\nTone: ${config.tone}.${traits}`;
    },
  };
}
