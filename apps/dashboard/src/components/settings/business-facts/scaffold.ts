import { BusinessFactsSchema, type BusinessFacts } from "@switchboard/schemas";
import type { z } from "zod";

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Form value type (pre-parse): all controlled fields present so inputs stay controlled. */
export type BusinessFactsForm = z.input<typeof BusinessFactsSchema>;

type HoursEntry = { open: string; close: string; closed: boolean };

function defaultHours(): Record<string, HoursEntry> {
  const weekday: HoursEntry = { open: "10:00", close: "20:00", closed: false };
  const weekend: HoursEntry = { open: "10:00", close: "18:00", closed: false };
  return {
    monday: { ...weekday },
    tuesday: { ...weekday },
    wednesday: { ...weekday },
    thursday: { ...weekday },
    friday: { ...weekday },
    saturday: { ...weekend },
    sunday: { open: "10:00", close: "18:00", closed: true },
  };
}

export function emptyService(): {
  name: string;
  description: string;
  price: string;
  currency: string;
} {
  return { name: "", description: "", price: "", currency: "SGD" };
}

export function emptyLocation(): {
  name: string;
  address: string;
  parkingNotes: string;
  accessNotes: string;
} {
  return { name: "", address: "", parkingNotes: "", accessNotes: "" };
}

export function emptyBusinessFacts(): BusinessFactsForm {
  return {
    businessName: "",
    timezone: "Asia/Singapore",
    locations: [emptyLocation()],
    openingHours: defaultHours(),
    services: [emptyService()],
    bookingPolicies: {},
    escalationContact: { name: "", channel: "whatsapp", address: "" },
    additionalFaqs: [],
  };
}

function clean(v: string | undefined | null): string | undefined {
  const t = (v ?? "").trim();
  return t === "" ? undefined : t;
}

function cleanPolicies(p: BusinessFactsForm["bookingPolicies"]): BusinessFacts["bookingPolicies"] {
  if (!p) return undefined;
  const out = {
    cancellationPolicy: clean(p.cancellationPolicy),
    reschedulePolicy: clean(p.reschedulePolicy),
    noShowPolicy: clean(p.noShowPolicy),
    prepInstructions: clean(p.prepInstructions),
    advanceBookingDays: p.advanceBookingDays || undefined,
  };
  return Object.values(out).every((x) => x === undefined) ? undefined : out;
}

/**
 * Form values → canonical BusinessFacts. Trims, drops empty optionals, then
 * parses through the SAME BusinessFactsSchema the proxy/route enforce — so the
 * payload is guaranteed acceptable. The form's zodResolver has already validated
 * the required fields, so parse() will not throw in practice.
 */
export function serializeBusinessFacts(values: BusinessFactsForm): BusinessFacts {
  const cleaned = {
    businessName: values.businessName.trim(),
    timezone: clean(values.timezone) ?? "Asia/Singapore",
    locations: values.locations.map((l) => ({
      name: l.name.trim(),
      address: l.address.trim(),
      parkingNotes: clean(l.parkingNotes),
      accessNotes: clean(l.accessNotes),
    })),
    openingHours: values.openingHours,
    services: (values.services ?? []).map((s) => ({
      name: s.name.trim(),
      description: s.description.trim(),
      durationMinutes: s.durationMinutes || undefined,
      price: clean(s.price),
      currency: clean(s.currency) ?? "SGD",
      bookingBehavior: s.bookingBehavior || undefined,
      consultationRequired: s.consultationRequired || undefined,
      prepInstructions: clean(s.prepInstructions),
      aftercareNotes: clean(s.aftercareNotes),
      idealFor: clean(s.idealFor),
      notSuitableFor: clean(s.notSuitableFor),
      popularCombinations:
        (s.popularCombinations ?? []).map((x) => x.trim()).filter(Boolean).length > 0
          ? (s.popularCombinations ?? []).map((x) => x.trim()).filter(Boolean)
          : undefined,
    })),
    bookingPolicies: cleanPolicies(values.bookingPolicies),
    escalationContact: {
      name: values.escalationContact.name.trim(),
      channel: values.escalationContact.channel,
      address: values.escalationContact.address.trim(),
    },
    additionalFaqs: (values.additionalFaqs ?? [])
      .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
      .filter((f) => f.question !== "" && f.answer !== ""),
  };
  return BusinessFactsSchema.parse(cleaned);
}
