export interface ContactRef {
  contactId: string;
  displayName: string;
}

type ExtractorFn = (snapshot: Record<string, unknown>) => ContactRef | null;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function fromNestedKey(key: string): ExtractorFn {
  return (snapshot) => {
    const nested = asRecord(snapshot[key]);
    if (!nested) return null;
    const contactId = asString(nested.contactId);
    const displayName = asString(nested.contactDisplayName);
    if (!contactId || !displayName) return null;
    return { contactId, displayName };
  };
}

function fromTopLevel(): ExtractorFn {
  return (snapshot) => {
    const contactId = asString(snapshot.contactId);
    if (!contactId) return null;
    const displayName =
      asString(snapshot.contactDisplayName) ??
      asString(asRecord(snapshot.contact)?.displayName ?? null);
    if (!displayName) return null;
    return { contactId, displayName };
  };
}

const EXTRACTORS: Record<string, ExtractorFn> = {
  "booking.create": fromNestedKey("booking"),
  "booking.confirmed": fromNestedKey("booking"),
  "lifecycle.qualified": fromTopLevel(),
  "lifecycle.qualified.advanced": fromTopLevel(),
  "lifecycle.disqualified": fromTopLevel(),
  "lifecycle.passed": fromTopLevel(),
  "message.sent": fromNestedKey("message"),
  "message.replied": fromNestedKey("message"),
  "message.batch_sent": fromNestedKey("message"),
  "approval.created": fromNestedKey("approval"),
  "escalation.created": fromTopLevel(),
  "escalation.opened": fromTopLevel(),
  "lead.created": fromTopLevel(),
  "leads.ingested": fromTopLevel(),
};

export function extractContactRef(
  eventType: string,
  snapshot: Record<string, unknown>,
): ContactRef | null {
  const extractor = EXTRACTORS[eventType];
  if (!extractor) return null;
  try {
    return extractor(snapshot);
  } catch {
    return null;
  }
}
