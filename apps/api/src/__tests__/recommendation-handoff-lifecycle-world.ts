// ── Lifecycle world: the REAL respond + dispatch stack over the harness ──
//
// Extracted from recommendation-handoff-approval-loop.test.ts (#879) so the
// chat-surface twin (chat-approval-loop.test.ts) drives the same world: REAL
// ApprovalLifecycleService over InMemoryLifecycleStore, REAL PlatformLifecycle
// over the harness's REAL ExecutionModeRegistry, in-memory storage + ledger.
// Lives outside recommendation-handoff-harness.ts to keep that file under the
// 600-line architecture gate.

import { PlatformLifecycle } from "@switchboard/core/platform";
import {
  ApprovalLifecycleService,
  InMemoryLifecycleStore,
  createInMemoryStorage,
  AuditLedger,
  InMemoryLedgerStorage,
} from "@switchboard/core";
import { buildHarness, allowPolicy, approvalPolicy } from "./recommendation-handoff-harness.js";

export function buildLifecycleWorld() {
  const store = new InMemoryLifecycleStore();
  const lifecycleService = new ApprovalLifecycleService({ store });
  const harness = buildHarness([allowPolicy(), approvalPolicy()], { lifecycleService });
  const storage = createInMemoryStorage();
  const ledger = new AuditLedger(new InMemoryLedgerStorage());
  const platformLifecycle = new PlatformLifecycle({
    approvalStore: storage.approvals,
    envelopeStore: storage.envelopes,
    identityStore: storage.identity,
    modeRegistry: harness.modeRegistry,
    traceStore: harness.traceStore,
    ledger,
    trustAdapter: null,
    selfApprovalAllowed: false,
    approvalRateLimit: null,
  });
  const logger = {
    info: () => {},
    error: () => {},
  };
  const deps = {
    lifecycleService,
    workTraceStore: harness.traceStore,
    platformLifecycle,
    auditLedger: ledger,
    logger,
  };
  return { store, lifecycleService, harness, storage, platformLifecycle, ledger, deps, logger };
}
