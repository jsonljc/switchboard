import {
  Project,
  type SourceFile,
  type InterfaceDeclaration,
  type TypeAliasDeclaration,
} from "ts-morph";
import { join } from "path";
import type { ValidatorWarning } from "./route-class-validator.js";

/**
 * Static enumeration of @switchboard/schemas export names that are
 * load-bearing cross-app value types. Hand-curated for PR-2.5; PR-4
 * may swap to a dynamic enumeration that walks
 * packages/schemas/src/index.ts via ts-morph.
 *
 * The set covers:
 *   - Types relocated by PR-2 (ApprovalRecord, ApprovalState, Handoff,
 *     ConversationState, ConversationSummary, ConversationDetail,
 *     ConversationListResult, OperatorOverview, plus the DashboardOverview
 *     back-compat alias).
 *   - Cross-app names already in schemas before PR-2 (Contact,
 *     ConversationThread, Opportunity, ContactBrowseRow).
 *
 * Names NOT in this set (e.g. MinimalApprovalRecord,
 * ApprovalRecordForResponse) are deliberately-narrower local shapes
 * and are not flagged.
 *
 * ConversationRow, Decision, and Recommendation were in the plan's draft
 * set but are NOT exported from @switchboard/schemas on the PR-2.5
 * baseline (verified by grep). Omitted to avoid false positives; PR-4
 * should re-verify against the live schemas index.
 */
const SCHEMAS_EXPORT_NAMES: ReadonlySet<string> = new Set([
  "ApprovalRecord",
  "ApprovalState",
  "ApprovalStatus",
  "QuorumState",
  "QuorumEntry",
  "Handoff",
  "HandoffStatus",
  "HandoffReason",
  "LeadSnapshot",
  "QualificationSnapshot",
  "ConversationState",
  "ConversationMessage",
  "ConversationSummary",
  "ConversationDetail",
  "ConversationListResult",
  "OperatorOverview",
  "DashboardOverview",
  "Contact",
  "ConversationThread",
  "Opportunity",
  "ContactBrowseRow",
  // Note: ConversationRow, Decision, and Recommendation were in the plan's
  // draft set but are NOT exported from @switchboard/schemas on the PR-2.5
  // baseline. They are deliberately omitted to avoid false positives.
  // PR-4 should re-verify against the live schemas index.
]);

const APP_SRC_RX = /^apps\/(api|chat|dashboard)\/src\//;
const TESTS_RX = /\/__tests__\//;
const SUPPRESS_DIRECTIVE_RX = /\/\/\s*route-governance:\s*local-view-model\b/;

export interface CrossAppTypesAdvisoryOptions {
  /** Repo-relative paths to scan. */
  touchedFiles: string[];
  /** Absolute repo root. */
  repoRoot: string;
}

export interface CrossAppTypesAdvisoryResult {
  warnings: ValidatorWarning[];
  exitCode: 0;
}

export async function runCrossAppTypesAdvisory(
  opts: CrossAppTypesAdvisoryOptions,
): Promise<CrossAppTypesAdvisoryResult> {
  const inScope = opts.touchedFiles.filter(
    (f) => APP_SRC_RX.test(f) && !TESTS_RX.test(f) && (f.endsWith(".ts") || f.endsWith(".tsx")),
  );
  if (inScope.length === 0) return { warnings: [], exitCode: 0 };

  const project = new Project({ useInMemoryFileSystem: false });
  const warnings: ValidatorWarning[] = [];

  for (const repoPath of inScope) {
    const abs = join(opts.repoRoot, repoPath);
    let sf: SourceFile;
    try {
      sf = project.addSourceFileAtPath(abs);
    } catch {
      continue; // file missing — skip silently
    }
    warnings.push(...scanFile(sf, repoPath));
  }

  return { warnings, exitCode: 0 };
}

function scanFile(sf: SourceFile, repoPath: string): ValidatorWarning[] {
  const out: ValidatorWarning[] = [];
  for (const decl of [...sf.getInterfaces(), ...sf.getTypeAliases()]) {
    if (!decl.isExported()) continue;
    const name = decl.getName();
    if (!SCHEMAS_EXPORT_NAMES.has(name)) continue;
    if (hasSuppressDirective(decl)) continue;
    out.push({
      path: repoPath,
      message: `local '${name}' duplicates @switchboard/schemas export — import { ${name} } from "@switchboard/schemas" instead, or annotate the declaration with '// route-governance: local-view-model' if a deliberately narrower local shape`,
    });
  }
  return out;
}

function hasSuppressDirective(decl: InterfaceDeclaration | TypeAliasDeclaration): boolean {
  // ts-morph: getLeadingCommentRanges returns the comments immediately above
  // the declaration node. Single-line comments lose newlines; we just need to
  // match the directive regex against their text.
  const ranges = decl.getLeadingCommentRanges();
  for (const r of ranges) {
    if (SUPPRESS_DIRECTIVE_RX.test(r.getText())) return true;
  }
  return false;
}
