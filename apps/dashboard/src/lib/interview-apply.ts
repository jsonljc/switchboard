import type { Playbook } from "@switchboard/schemas";
import type { ResponseUpdate } from "./interview-engine";

export function applyInterviewUpdate(playbook: Playbook, update: ResponseUpdate): Playbook {
  const result = structuredClone(playbook);
  const section = update.section as keyof Playbook;
  const sectionData = result[section];

  // Skip sections where user has manually edited and marked ready
  if (typeof sectionData === "object" && !Array.isArray(sectionData) && "source" in sectionData) {
    if (sectionData.source === "manual" && sectionData.status === "ready") {
      return result;
    }
  }

  // Services: append rather than replace
  if (section === "services" && update.fields.services) {
    const parsed = update.fields.services as Array<{ name: string; price?: number }>;
    const newServices = parsed.map((s) => ({
      id: crypto.randomUUID(),
      name: s.name,
      price: s.price,
      bookingBehavior: "ask_first" as const,
      status: "check_this" as const,
      source: "interview" as const,
    }));
    result.services = [...result.services, ...newServices];
    return result;
  }

  // Object sections: merge fields, set status and source
  if (typeof sectionData === "object" && !Array.isArray(sectionData)) {
    const { unparsedInput: _unparsed, ...structuredFields } = update.fields;
    (result as Record<string, unknown>)[section] = {
      ...sectionData,
      ...structuredFields,
      status: update.newStatus,
      source: "interview",
    };
  }

  return result;
}
