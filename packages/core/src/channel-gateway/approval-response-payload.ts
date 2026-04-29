export type ParsedApprovalResponsePayload = {
  action: "approve" | "reject";
  approvalId: string;
  bindingHash: string;
};

const ALLOWED_KEYS = new Set(["action", "approvalId", "bindingHash"]);

export function parseApprovalResponsePayload(
  text: string | null | undefined,
): ParsedApprovalResponsePayload | null {
  if (typeof text !== "string" || text.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) return null;
  }

  const { action, approvalId, bindingHash } = obj;
  if (action !== "approve" && action !== "reject") return null;
  if (typeof approvalId !== "string" || approvalId.length === 0) return null;
  if (typeof bindingHash !== "string" || bindingHash.length === 0) return null;

  return { action, approvalId, bindingHash };
}
