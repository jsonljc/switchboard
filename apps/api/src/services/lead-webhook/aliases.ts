export type CanonicalField = "phone" | "email" | "name" | "firstName" | "lastName" | "message";

const ALIASES: Record<CanonicalField, string[]> = {
  phone: [
    "phone",
    "phonenumber",
    "phone_number",
    "mobile",
    "tel",
    "whatsapp",
    "contact number",
    "mobile number",
    "contactnumber",
    "mobilenumber",
  ],
  email: ["email", "emailaddress", "email_address", "e-mail", "e_mail"],
  name: ["name", "fullname", "full_name", "full name"],
  firstName: ["firstname", "first_name", "first name", "given name", "givenname"],
  lastName: ["lastname", "last_name", "last name", "family name", "familyname", "surname"],
  message: [
    "message",
    "notes",
    "comments",
    "inquiry",
    "enquiry",
    "details",
    "comment",
    "note",
    "question",
  ],
};

const LOOKUP = new Map<string, CanonicalField>();
for (const [canonical, aliases] of Object.entries(ALIASES) as Array<[CanonicalField, string[]]>) {
  for (const a of aliases) LOOKUP.set(a, canonical);
}

export function matchAlias(label: string): CanonicalField | null {
  if (!label) return null;
  const norm = label.trim().toLowerCase();
  return LOOKUP.get(norm) ?? null;
}
