// apps/api/src/bootstrap/lifecycle.ts
// ---------------------------------------------------------------------------
// Phase 3a conversation-lifecycle bootstrap
// ---------------------------------------------------------------------------
// IoC-style wiring module. Constructs the Phase 3a LifecycleWriter +
// ReEngagementAttributor + PrismaMessageHistoryReader against Prisma-backed
// stores and exposes five `registerXHook` seams plus a `registerCron` seam.
// Callers supply the real subscription mechanism for each seat; the unit test
// stubs every registrar with a mock so the bootstrap surface stays decoupled
// from any concrete transport (Prisma onWrite callback, chat gateway hooks,
// Inngest client).
//
// Wiring status (Task 15 / post-review):
//   5a verdict-write              — DEFERRED (no caller passes a real registrar yet)
//   5b booking-created            — DEFERRED (no caller passes a real registrar yet)
//   5c inbound-message            — DEFERRED (no caller passes a real registrar yet)
//   5d operator-takeover          — DEFERRED (no caller passes a real registrar yet)
//   5e thread-first-observation   — DEFERRED (no caller passes a real registrar yet)
//   stalled-sweep cron            — REAL (apps/api/src/bootstrap/inngest.ts calls
//                                   bootstrapLifecycle to obtain { writer, history }
//                                   and registers createLifecycleStalledSweepCron
//                                   alongside the other Inngest functions)
//
// All five `registerXHook` seams are invoked from this module regardless of
// whether their concrete subscription wiring has landed — the test asserts a
// complete surface so the eventual wiring PR cannot regress the registration
// step silently. The DEFERRED comments inside the function body point to the
// exact file:line where the future producer wiring must connect.

import {
  LifecycleWriter,
  LifecycleConfigResolver,
  ReEngagementAttributor,
  QualificationEvaluationHook,
  DisqualificationResolver,
  DisqualificationResolutionHook,
  onGovernanceVerdictWritten,
  onBookingCreated,
  onInboundMessage,
  onOperatorTakeover,
  onThreadFirstObservation,
  type LifecycleSnapshotStore,
  type MessageHistoryReader,
  type GovernanceVerdictEvent,
  type BookingCreatedEvent,
  type InboundMessageEvent,
  type OperatorTakeoverEvent,
  type ThreadFirstObservationEvent,
  type PlaybookReader,
} from "@switchboard/core";
import {
  PrismaConversationLifecycleSnapshotStore,
  PrismaConversationLifecycleTransitionStore,
  PrismaMessageHistoryReader,
  PrismaReEngagementVerdictReader,
  type PrismaClient,
} from "@switchboard/db";

export type LifecycleModeReader = (orgId: string) => Promise<"on" | "off">;

export interface BootstrapLifecycleDeps {
  prisma: PrismaClient;
  readMode: LifecycleModeReader;
  registerVerdictWriteHook: (cb: (event: GovernanceVerdictEvent) => Promise<void>) => void;
  registerBookingCreateHook: (cb: (event: BookingCreatedEvent) => Promise<void>) => void;
  registerInboundMessageHook: (cb: (event: InboundMessageEvent) => Promise<void>) => void;
  registerOperatorTakeoverHook: (cb: (event: OperatorTakeoverEvent) => Promise<void>) => void;
  registerThreadInitHook: (cb: (event: ThreadFirstObservationEvent) => Promise<void>) => void;
  registerCron: (name: string, schedule: string, fn: () => Promise<void>) => void;
  /** Phase 3b: reads per-org playbook for qualification treatment resolution. */
  playbookReader: PlaybookReader;
  /** Phase 3b: resolves governance config for an org (used to build LifecycleConfigResolver). */
  governanceConfigResolver: { resolve(organizationId: string): Promise<unknown> };
  /** Test hook: invoked after each registrar fires so the unit test can assert the order/set. */
  onHookRegister?: (name: string) => void;
}

export interface BootstrapLifecycleResult {
  writer: LifecycleWriter;
  attributor: ReEngagementAttributor;
  snapshotStore: LifecycleSnapshotStore;
  transitionStore: import("@switchboard/core").LifecycleTransitionStore;
  history: MessageHistoryReader;
  /** Phase 3b: evaluates qualification signals emitted in a sidecar and writes transitions. */
  qualificationEvaluationHook: QualificationEvaluationHook;
  /** Phase 3b: operator-facing hook for confirming/dismissing proposed disqualifications. */
  disqualificationHook: DisqualificationResolutionHook;
  /** Phase 3b: underlying resolver exposed for direct use by API route handlers (Task 15). */
  disqualificationResolver: DisqualificationResolver;
}

export function bootstrapLifecycle(deps: BootstrapLifecycleDeps): BootstrapLifecycleResult {
  const snapshotStore = new PrismaConversationLifecycleSnapshotStore(deps.prisma);
  const transitionStore = new PrismaConversationLifecycleTransitionStore(deps.prisma);
  const verdictReader = new PrismaReEngagementVerdictReader(deps.prisma);
  const history = new PrismaMessageHistoryReader(deps.prisma);

  // Phase 3b: config resolver reads mechanical + qualification flags per org.
  // Replaces the hardcoded `new Set(["mechanical"])` from Phase 3a.
  const configResolver = new LifecycleConfigResolver({
    governanceConfigResolver: deps.governanceConfigResolver,
  });

  const writer = new LifecycleWriter({
    snapshotStore,
    transitionStore,
    runInTransaction: (fn) => deps.prisma.$transaction(fn),
    resolveCapabilities: (orgId) => configResolver.resolveCapabilities(orgId),
  });
  const attributor = new ReEngagementAttributor(verdictReader);

  // 5a — verdict-write subscription. DEFERRED wiring.
  // The PrismaGovernanceVerdictStore exposes an `onWrite` constructor option
  // and is instantiated at apps/api/src/bootstrap/skill-mode.ts:107. No caller
  // currently passes a real registrar from app.ts → skill-mode bootstrap; the
  // registrar below is invoked but no producer fires it yet.
  deps.registerVerdictWriteHook((event) =>
    onGovernanceVerdictWritten(writer, deps.readMode, event),
  );
  deps.onHookRegister?.("governance-verdict-escalation");

  // 5b — booking-created. DEFERRED wiring.
  // The only bookingStore.create seat lives at
  //   packages/core/src/skill-runtime/tools/calendar-book.ts:187
  // which does NOT have conversationThreadId in scope. Real wiring requires
  // either (a) propagating conversationThreadId down to the tool boundary, or
  // (b) a thread-by-(contactId, organizationId) lookup at the call site. Both
  // cross package layers and warrant their own follow-up.
  deps.registerBookingCreateHook((event) => onBookingCreated(writer, deps.readMode, event));
  deps.onHookRegister?.("booking-created");

  // 5c — inbound-message. DEFERRED wiring.
  // The chat gateway persists inbound messages via
  //   apps/chat/src/gateway/gateway-conversation-store.ts
  // (addMessage / persistInboundMessage). A callback option needs to be added
  // there so the chat layer can invoke this callback whenever a new inbound
  // message is persisted. Until then this registrar wires the handler but no
  // producer fires it.
  deps.registerInboundMessageHook((event) =>
    onInboundMessage(writer, snapshotStore, attributor, deps.readMode, event),
  );
  deps.onHookRegister?.("inbound-message");

  // 5d — operator-takeover. DEFERRED wiring.
  // No producer seat exists in the codebase yet: no API endpoint, no
  // `assignedOperatorId` column on ConversationThread, no actor-role on
  // ConversationMessage. Real wiring requires either a migration adding the
  // column + a dashboard route that flips it, or an explicit "operator took
  // over" event. The registrar is invoked so the bootstrap surface stays
  // complete.
  deps.registerOperatorTakeoverHook((event) => onOperatorTakeover(writer, deps.readMode, event));
  deps.onHookRegister?.("operator-takeover");

  // 5e — thread-first-observation. DEFERRED wiring.
  // The chat gateway creates new ConversationThread rows via
  //   apps/chat/src/gateway/gateway-conversation-store.ts
  // (getOrCreateBySession). A callback option needs to be added there so the
  // chat layer can invoke this callback whenever a new ConversationThread row
  // is created. Until then this registrar wires the handler but no producer
  // fires it.
  deps.registerThreadInitHook((event) =>
    onThreadFirstObservation(writer, snapshotStore, deps.readMode, event),
  );
  deps.onHookRegister?.("thread-first-observation");

  // Cron — registration here is an IoC seam used by the unit test. The real
  // Inngest function lives in apps/api/src/services/cron/lifecycle-stalled-sweep.ts
  // and is registered alongside the other crons in
  // apps/api/src/bootstrap/inngest.ts (using `writer` and `history` from this
  // bootstrap result).
  deps.registerCron("lifecycle.stalled-sweep", "0 * * * *", async () => {
    // Intentionally empty here: the real cron body lives at the Inngest seat.
  });
  deps.onHookRegister?.("stalled-sweep-cron");

  // Phase 3b — qualification hooks.
  const qualificationEvaluationHook = new QualificationEvaluationHook({
    writer,
    snapshotStore,
    playbookReader: deps.playbookReader,
    configResolver,
  });

  const disqualificationResolver = new DisqualificationResolver({
    snapshotStore,
    transitionStore,
    writer,
  });

  const disqualificationHook = new DisqualificationResolutionHook({
    resolver: disqualificationResolver,
    configResolver,
  });

  return {
    writer,
    attributor,
    snapshotStore,
    transitionStore,
    history,
    qualificationEvaluationHook,
    disqualificationHook,
    disqualificationResolver,
  };
}
