import type { SourceFile, CallExpression } from "ts-morph";
import { SyntaxKind } from "ts-morph";

const MUTATING_METHODS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

export interface ApprovalMutation {
  method: string;
  line: number;
}

/**
 * Flag mutating calls whose immediate receiver is named `approval` or `approvals`.
 *
 * Intended use: pass route handler files (the caller scopes by path). The function
 * itself does not filter by filename.
 *
 * Known false-negatives (the calling skill must cover these by reasoning):
 * - Aliased receivers: `const a = db.approval; a.create(...)`
 * - Element access: `db["approval"].create(...)`
 * - Renamed properties: `approvalRepo.create(...)`, `pendingApprovals.update(...)`
 * - Calls through helper functions or service classes that hide the prisma model.
 *
 * Known false-positives (treat findings as candidates to investigate, not violations):
 * - Method-name collisions on unrelated `.approval`/`.approvals` properties
 *   (e.g. an in-memory `Map.delete`).
 */
export function findApprovalMutations(sf: SourceFile): ApprovalMutation[] {
  const out: ApprovalMutation[] = [];
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node as CallExpression;
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const method = propAccess.getName();
    if (!MUTATING_METHODS.has(method)) return;
    const receiver = propAccess.getExpression();
    if (receiver.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    const receiverProp = receiver.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
    if (receiverProp !== "approval" && receiverProp !== "approvals") return;
    out.push({ method, line: call.getStartLineNumber() });
  });
  return out;
}
