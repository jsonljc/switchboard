import {
  REQUIRED_SECTIONS,
  getPlaybookReadiness,
  isPlaybookReady,
  type Playbook,
} from "@switchboard/schemas";

const SECTION_DISPLAY_NAMES: Record<string, string> = {
  businessIdentity: "Business Identity",
  services: "Services",
  hours: "Hours & Availability",
  bookingRules: "Booking Rules",
  approvalMode: "Approval Mode",
  escalation: "Escalation",
  channels: "Channels",
};

export function getSectionDisplayName(key: string): string {
  return SECTION_DISPLAY_NAMES[key] ?? key;
}

export function getRequiredSectionCount(): number {
  return REQUIRED_SECTIONS.length;
}

export function getReadySectionCount(playbook: Playbook): number {
  const readiness = getPlaybookReadiness(playbook);
  return Object.values(readiness).filter((s) => s === "ready").length;
}

export function getNextMissingSection(
  playbook: Playbook,
): (typeof REQUIRED_SECTIONS)[number] | null {
  const readiness = getPlaybookReadiness(playbook);
  for (const section of REQUIRED_SECTIONS) {
    if (readiness[section] !== "ready") return section;
  }
  return null;
}

export function getReadinessLabel(playbook: Playbook): string {
  if (isPlaybookReady(playbook)) return "Ready to test Alex";

  const ready = getReadySectionCount(playbook);
  const total = getRequiredSectionCount();
  const remaining = total - ready;

  if (remaining === 1) {
    const missing = getNextMissingSection(playbook);
    if (missing) {
      return `Almost ready: set your ${getSectionDisplayName(missing)}`;
    }
  }

  return `${ready} of ${total} required sections ready`;
}

export { getPlaybookReadiness, isPlaybookReady };
