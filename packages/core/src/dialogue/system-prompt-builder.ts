// ---------------------------------------------------------------------------
// System Prompt Builder — assembles localised prompts from NaturalnessPacket
// ---------------------------------------------------------------------------

import type { NaturalnessPacket, PrimaryMove } from "./types.js";

/** Move-specific instruction templates. */
const MOVE_INSTRUCTIONS: Record<PrimaryMove, string> = {
  greet:
    "Welcome the lead warmly. Introduce yourself briefly. Ask one opening question about what they're looking for.",
  acknowledge_and_hold:
    "Acknowledge what they said with empathy. Do NOT ask another question. Mirror their energy level. Keep it short.",
  answer_question:
    "Answer their question directly using the approved content. Be concise. End with a soft lead-in to continue the conversation.",
  ask_qualification_question:
    "Ask ONE qualification question from the approved content. Make it feel conversational, not like a form.",
  handle_objection:
    "Address their concern directly. Use the approved response. Follow up with the approved follow-up question.",
  advance_to_booking:
    "Transition naturally to booking. Present the booking option. Make it easy and low-pressure.",
  confirm_booking: "Confirm the booking details. Express enthusiasm. Provide next steps.",
  send_reminder: "Send a friendly reminder about their upcoming appointment.",
  reactivate:
    "Re-engage warmly. Reference their previous interest if known. Offer something new or a special offer.",
  escalate_to_human:
    "Let them know you're connecting them with a team member. Assure them someone will be in touch shortly.",
  clarify:
    "Politely ask for clarification about what they need. Offer 2-3 specific options they might be asking about.",
  close: "Thank them warmly. Wish them well. Keep the door open for future contact.",
};

/** Market-specific voice instructions. */
const MARKET_VOICE: Record<string, string> = {
  SG: "Use natural Singaporean English. Occasional Singlish particles (lah, leh) are OK if the lead uses them first. Keep it warm and efficient.",
  MY: "Use natural Malaysian English. Mirror the lead's formality level. Occasional Malay words are OK if the lead uses them.",
  US: "Use standard American English. Warm and professional.",
  UK: "Use British English. Polite and professional.",
  AU: "Use Australian English. Friendly and relaxed.",
  generic: "Use clear, warm English. Professional but approachable.",
};

export function buildLocalisedSystemPrompt(
  packet: NaturalnessPacket,
  businessContext?: string,
): string {
  const sections: string[] = [];

  // Persona block
  sections.push("You are a lead-engagement assistant for a service business.");

  // Voice block
  const voiceInstruction = MARKET_VOICE[packet.voice.market] ?? MARKET_VOICE["generic"]!;
  sections.push(`\nVOICE: ${voiceInstruction}`);
  if (packet.voice.naturalness === "casual") {
    sections.push("Keep tone conversational and casual.");
  } else if (packet.voice.naturalness === "formal") {
    sections.push("Maintain a professional and formal tone.");
  }

  // Emoji policy
  if (packet.voice.emojiPolicy.allowed) {
    sections.push(
      `Emoji: Use up to ${packet.voice.emojiPolicy.maxPerMessage} per message. Preferred: ${packet.voice.emojiPolicy.preferredSet.join(" ")}`,
    );
  } else {
    sections.push("Emoji: Do NOT use emoji.");
  }

  // Constraint block
  sections.push(`\nCONSTRAINTS:`);
  sections.push(
    `- Maximum ${packet.constraints.maxSentences} sentences, ${packet.constraints.maxWords} words`,
  );
  sections.push("- Ask only ONE question per message");
  sections.push("- Do NOT use em dashes (—)");
  if (packet.constraints.forbiddenPhrases.length > 0) {
    sections.push(`- NEVER use these phrases: ${packet.constraints.forbiddenPhrases.join(", ")}`);
  }
  if (packet.constraints.bannedTopics.length > 0) {
    sections.push(`- NEVER discuss: ${packet.constraints.bannedTopics.join(", ")}`);
  }

  // Content block
  if (packet.approvedContent) {
    sections.push(`\nAPPROVED CONTENT:\n${packet.approvedContent}`);
  }

  // Lead context
  sections.push("\nLEAD CONTEXT:");
  if (packet.leadContext.name) sections.push(`- Name: ${packet.leadContext.name}`);
  if (packet.leadContext.serviceInterest) {
    sections.push(`- Interested in: ${packet.leadContext.serviceInterest}`);
  }
  if (packet.leadContext.qualificationStage) {
    sections.push(`- Stage: ${packet.leadContext.qualificationStage}`);
  }
  sections.push(`- Turn count: ${packet.leadContext.previousTurnCount}`);

  // Variation
  sections.push(`\nOPENING STYLE: ${packet.variation.openingStyle}`);
  if (packet.variation.avoidPatterns.length > 0) {
    sections.push(`Avoid starting with: ${packet.variation.avoidPatterns.join(", ")}`);
  }

  // Move instruction
  const moveInstruction = MOVE_INSTRUCTIONS[packet.primaryMove];
  sections.push(`\nYOUR MOVE: ${packet.primaryMove}`);
  sections.push(moveInstruction);

  // Business context
  if (businessContext) {
    sections.push(`\n${businessContext}`);
  }

  return sections.join("\n");
}
