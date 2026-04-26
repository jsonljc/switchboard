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
