import type { Playbook } from "@switchboard/schemas";
import type { TestPrompt } from "@/components/onboarding/prompt-card";

export function generateTestPrompts(playbook: Playbook): TestPrompt[] {
  const prompts: TestPrompt[] = [];

  if (playbook.services.length === 0) return prompts;

  const first = playbook.services[0];
  const second = playbook.services.length > 1 ? playbook.services[1] : null;

  prompts.push({
    id: "booking-1",
    category: "BOOKING",
    text: `I'd like to book a ${first.name} session. Do you have anything this Saturday?`,
    recommended: true,
  });

  if (first.price) {
    prompts.push({
      id: "pricing-1",
      category: "PRICING",
      text: `How much is ${first.name}?`,
      recommended: false,
    });
  }

  if (second) {
    prompts.push({
      id: "pricing-2",
      category: "PRICING",
      text: `What's the difference between ${first.name} and ${second.name}?`,
      recommended: false,
    });
  }

  prompts.push({
    id: "changes-1",
    category: "CHANGES",
    text: `I booked a ${first.name} for tomorrow but I need to reschedule. Can I move it to next week?`,
    recommended: false,
  });

  if (playbook.escalation.triggers.length > 0) {
    prompts.push({
      id: "edge-1",
      category: "EDGE_CASES",
      text: `I want a ${playbook.escalation.triggers[0]}. Who do I talk to?`,
      recommended: false,
    });
  }

  if (Object.keys(playbook.hours.schedule).length > 0) {
    prompts.push({
      id: "edge-2",
      category: "EDGE_CASES",
      text: "Are you open on Sunday? I can only come on weekends.",
      recommended: false,
    });
  }

  return prompts;
}
