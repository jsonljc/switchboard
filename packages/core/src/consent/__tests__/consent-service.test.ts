import { describe, it, expect, vi } from "vitest";
import {
  createConsentService,
  ConsentJurisdictionMismatch,
  ConsentNotesRequired,
  ConsentRevokedCannotRegrant,
  ConsentSystemActorRejected,
  ContactNotFound,
  type ConsentStateStore,
} from "../index.js";
import type { GovernanceVerdictStore } from "../../governance/governance-verdict-store/types.js";
import type { HandoffStore } from "../../handoff/types.js";
import type { ConversationStatusSetter } from "../../skill-runtime/hooks/deterministic-safety-gate.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buildStore = (initial: any = {}): ConsentStateStore => {
  let state = initial;
  return {
    readOrNull: vi.fn().mockImplementation(async () => state),
    setJurisdictionIfNull: vi.fn().mockImplementation(async (_id: string, j: string) => {
      if (state?.pdpaJurisdiction == null) state = { ...(state ?? {}), pdpaJurisdiction: j };
    }),
    setDisclosure: vi
      .fn()
      .mockImplementation(
        async ({ version, shownAt, actor }: { version: string; shownAt: Date; actor: string }) => {
          state = {
            ...(state ?? {}),
            aiDisclosureVersionShown: version,
            aiDisclosureShownAt: shownAt.toISOString(),
            consentUpdatedBy: actor,
          };
        },
      ),
    setGrant: vi
      .fn()
      .mockImplementation(
        async ({
          grantedAt,
          source,
          actor,
        }: {
          grantedAt: Date;
          source: string;
          actor: string;
        }) => {
          state = {
            ...(state ?? {}),
            consentGrantedAt: grantedAt.toISOString(),
            consentSource: source,
            consentUpdatedBy: actor,
          };
        },
      ),
    setRevocationIfNotRevoked: vi
      .fn()
      .mockImplementation(
        async ({
          revokedAt,
          source,
          actor,
          notes,
        }: {
          revokedAt: Date;
          source: string;
          actor: string;
          notes?: string;
        }) => {
          if (state?.consentRevokedAt) {
            return { wasNewlyRevoked: false, existingRevokedAt: new Date(state.consentRevokedAt) };
          }
          state = {
            ...(state ?? {}),
            consentRevokedAt: revokedAt.toISOString(),
            consentSource: source,
            consentUpdatedBy: actor,
            consentNotes: notes ?? null,
          };
          return { wasNewlyRevoked: true, existingRevokedAt: null };
        },
      ),
    clearConsentTimestamps: vi
      .fn()
      .mockImplementation(async ({ actor, notes }: { actor: string; notes: string }) => {
        const previousGrantedAt = state?.consentGrantedAt ? new Date(state.consentGrantedAt) : null;
        const previousRevokedAt = state?.consentRevokedAt ? new Date(state.consentRevokedAt) : null;
        state = {
          ...(state ?? {}),
          consentGrantedAt: null,
          consentRevokedAt: null,
          consentSource: null,
          consentUpdatedBy: actor,
          consentNotes: notes,
        };
        return { previousGrantedAt, previousRevokedAt };
      }),
  };
};

const buildVerdictStore = (): GovernanceVerdictStore =>
  ({
    save: vi.fn().mockResolvedValue({} as never),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const buildHandoffStore = (): HandoffStore =>
  ({
    save: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue(null),
    getBySessionId: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    listPending: vi.fn().mockResolvedValue([]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const buildConvStore = (): ConversationStatusSetter => ({
  setConversationStatus: vi.fn().mockResolvedValue(undefined),
});

const ctx = (overrides: Partial<{ store: ConsentStateStore }> = {}) => {
  const store = overrides.store ?? buildStore();
  const verdictStore = buildVerdictStore();
  const handoffStore = buildHandoffStore();
  const conversationStore = buildConvStore();
  const clock = () => new Date("2026-05-11T10:00:00Z");

  const service = createConsentService({
    store,
    verdictStore,
    handoffStore,
    conversationStore,
    clock,
    deploymentId: "d1",
    orgId: "org1",
    clinicType: "medical",
  });
  return { service, store, verdictStore, handoffStore, conversationStore };
};

describe("ConsentService.attachToGovernedInteraction", () => {
  it("stamps jurisdiction when currently null", async () => {
    const { service, store } = ctx();
    await service.attachToGovernedInteraction("c1", "SG", "org1");
    expect(store.setJurisdictionIfNull).toHaveBeenCalledWith("c1", "SG", "org1");
  });

  it("throws ConsentJurisdictionMismatch when a different jurisdiction is stamped", async () => {
    const { service } = ctx({ store: buildStore({ pdpaJurisdiction: "SG" }) });
    await expect(service.attachToGovernedInteraction("c1", "MY", "org1")).rejects.toBeInstanceOf(
      ConsentJurisdictionMismatch,
    );
  });

  it("no-op when same jurisdiction is already stamped", async () => {
    const store = buildStore({ pdpaJurisdiction: "MY" });
    const { service, verdictStore } = ctx({ store });
    await service.attachToGovernedInteraction("c1", "MY", "org1");
    // No verdict on no-op stamps.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((verdictStore.save as any).mock.calls.length).toBe(0);
  });
});

describe("ConsentService.recordDisclosureShown", () => {
  it("stamps version + shownAt; does NOT touch consent timestamps", async () => {
    const { service, store } = ctx();
    await service.recordDisclosureShown({
      contactId: "c1",
      jurisdiction: "SG",
      version: "sg-disclosure@1.0.0",
      shownAt: new Date("2026-05-11T09:59:00Z"),
      actor: "system:skill_runtime",
      organizationId: "org1",
    });
    expect(store.setDisclosure).toHaveBeenCalled();
    expect(store.setGrant).not.toHaveBeenCalled();
    expect(store.setRevocationIfNotRevoked).not.toHaveBeenCalled();
  });

  it("idempotent on same version (no setDisclosure call)", async () => {
    const { service, store } = ctx({
      store: buildStore({
        pdpaJurisdiction: "SG",
        aiDisclosureVersionShown: "sg-disclosure@1.0.0",
      }),
    });
    await service.recordDisclosureShown({
      contactId: "c1",
      jurisdiction: "SG",
      version: "sg-disclosure@1.0.0",
      shownAt: new Date(),
      actor: "system:skill_runtime",
      organizationId: "org1",
    });
    expect(store.setDisclosure).not.toHaveBeenCalled();
  });

  it("writes a `disclosure_version_bumped` verdict on version change", async () => {
    const { service, store, verdictStore } = ctx({
      store: buildStore({
        pdpaJurisdiction: "SG",
        aiDisclosureVersionShown: "sg-disclosure@0.9.0",
      }),
    });
    await service.recordDisclosureShown({
      contactId: "c1",
      jurisdiction: "SG",
      version: "sg-disclosure@1.0.0",
      shownAt: new Date(),
      actor: "system:skill_runtime",
      organizationId: "org1",
    });
    expect(store.setDisclosure).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = (verdictStore.save as any).mock.calls[0][0];
    expect(saved.reasonCode).toBe("allowed");
    expect(saved.details.event).toBe("disclosure_version_bumped");
    expect(saved.details.previousVersion).toBe("sg-disclosure@0.9.0");
    expect(saved.details.newVersion).toBe("sg-disclosure@1.0.0");
  });
});

describe("ConsentService.recordGrant", () => {
  it("stamps grantedAt and emits consent_granted verdict", async () => {
    const { service, store, verdictStore } = ctx();
    await service.recordGrant({
      contactId: "c1",
      jurisdiction: "MY",
      source: "whatsapp_quick_reply",
      grantedAt: new Date("2026-05-11T10:00:00Z"),
      actor: "system:skill_runtime",
    });
    expect(store.setGrant).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((verdictStore.save as any).mock.calls[0][0].reasonCode).toBe("allowed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((verdictStore.save as any).mock.calls[0][0].details.event).toBe("consent_granted");
  });

  it("threads the effective organization to the scoped read AND write (A3: closes cross-tenant write)", async () => {
    // Previously recordGrant discarded the organizationId it received and called
    // the store by contactId only — letting org A mutate org B's contact consent.
    const { service, store } = ctx();
    await service.recordGrant({
      contactId: "c1",
      jurisdiction: "MY",
      source: "operator_recorded",
      grantedAt: new Date("2026-05-11T10:00:00Z"),
      actor: "user_42",
      organizationId: "org-operator",
    });
    expect(store.readOrNull).toHaveBeenCalledWith("c1", "org-operator");
    expect(store.setGrant).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-operator" }),
    );
  });

  it("throws ConsentRevokedCannotRegrant when revokedAt is set", async () => {
    const { service } = ctx({
      store: buildStore({
        pdpaJurisdiction: "MY",
        consentRevokedAt: new Date("2026-05-10").toISOString(),
      }),
    });
    await expect(
      service.recordGrant({
        contactId: "c1",
        jurisdiction: "MY",
        source: "operator_recorded",
        grantedAt: new Date(),
        actor: "user_42",
      }),
    ).rejects.toBeInstanceOf(ConsentRevokedCannotRegrant);
  });
});

describe("ConsentService.recordRevocation", () => {
  it("is idempotent — second call is a no-op with no verdict", async () => {
    const store = buildStore();
    const { service, verdictStore } = ctx({ store });
    await service.recordRevocation({
      contactId: "c1",
      source: "inbound_keyword_revocation",
      revokedAt: new Date("2026-05-11"),
      actor: "system:inbound_keyword_revocation",
    });
    await service.recordRevocation({
      contactId: "c1",
      source: "inbound_keyword_revocation",
      revokedAt: new Date("2026-05-12"),
      actor: "system:inbound_keyword_revocation",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((verdictStore.save as any).mock.calls.length).toBe(1);
  });

  it("flips conversation status when openConversationSessionId is provided", async () => {
    const { service, conversationStore } = ctx();
    await service.recordRevocation({
      contactId: "c1",
      source: "inbound_keyword_revocation",
      revokedAt: new Date(),
      actor: "system:inbound_keyword_revocation",
      openConversationSessionId: "sess1",
    });
    // Option (b): only 2 args — no upsertContext
    expect(conversationStore.setConversationStatus).toHaveBeenCalledWith("sess1", "human_override");
  });

  it("per-call organizationId override is used in handoff package (not constructor orgId)", async () => {
    const { service, handoffStore } = ctx();
    await service.recordRevocation({
      contactId: "c1",
      source: "inbound_keyword_revocation",
      revokedAt: new Date(),
      actor: "system:inbound_keyword_revocation",
      openConversationSessionId: "sess1",
      organizationId: "org-override",
    });
    // handoffStore.save receives the package built with the override orgId, not "org1"
    expect(handoffStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-override" }),
    );
  });

  it("per-call deploymentId override scopes verdict to that deployment", async () => {
    const { service, verdictStore } = ctx();
    await service.recordRevocation({
      contactId: "c1",
      source: "inbound_keyword_revocation",
      revokedAt: new Date(),
      actor: "system:inbound_keyword_revocation",
      deploymentId: "d-override",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = (verdictStore.save as any).mock.calls[0][0];
    expect(saved.deploymentId).toBe("d-override");
  });
});

describe("ConsentService.clearConsent", () => {
  it("rejects empty notes with ConsentNotesRequired", async () => {
    const { service } = ctx();
    await expect(
      service.clearConsent({ contactId: "c1", actor: "user_42", notes: "" }),
    ).rejects.toBeInstanceOf(ConsentNotesRequired);
  });

  it("rejects system: actors with ConsentSystemActorRejected carrying the actor", async () => {
    const { service } = ctx();
    await expect(
      service.clearConsent({
        contactId: "c1",
        actor: "system:something",
        notes: "operator reset",
      }),
    ).rejects.toBeInstanceOf(ConsentSystemActorRejected);
  });

  it("emits consent_cycle_reset warning verdict on success", async () => {
    const { service, verdictStore } = ctx();
    await service.clearConsent({
      contactId: "c1",
      actor: "user_42",
      notes: "operator-recorded reset after consent cycle complete",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = (verdictStore.save as any).mock.calls[0][0];
    expect(saved.reasonCode).toBe("consent_cycle_reset");
    expect(saved.auditLevel).toBe("warning");
  });
});

describe("ConsentService — disclosure ↔ consent orthogonality", () => {
  it("recordDisclosureShown leaves consent timestamps unchanged", async () => {
    const store = buildStore({
      pdpaJurisdiction: "SG",
      consentGrantedAt: new Date("2026-05-01").toISOString(),
      consentRevokedAt: null,
    });
    const { service } = ctx({ store });
    await service.recordDisclosureShown({
      contactId: "c1",
      jurisdiction: "SG",
      version: "sg-disclosure@1.0.0",
      shownAt: new Date(),
      actor: "system:skill_runtime",
      organizationId: "org1",
    });
    expect(store.setGrant).not.toHaveBeenCalled();
    expect(store.setRevocationIfNotRevoked).not.toHaveBeenCalled();
  });

  it("recordGrant leaves disclosure timestamps unchanged", async () => {
    const store = buildStore();
    const { service } = ctx({ store });
    await service.recordGrant({
      contactId: "c1",
      jurisdiction: "MY",
      source: "web_form",
      grantedAt: new Date(),
      actor: "user_42",
    });
    expect(store.setDisclosure).not.toHaveBeenCalled();
  });

  it("recordRevocation leaves disclosure timestamps unchanged", async () => {
    const store = buildStore();
    const { service } = ctx({ store });
    await service.recordRevocation({
      contactId: "c1",
      source: "inbound_keyword_revocation",
      revokedAt: new Date(),
      actor: "system:inbound_keyword_revocation",
    });
    expect(store.setDisclosure).not.toHaveBeenCalled();
  });
});

const buildNullStore = (): ConsentStateStore => ({
  readOrNull: vi.fn().mockResolvedValue(null),
  setJurisdictionIfNull: vi.fn().mockResolvedValue(undefined),
  setDisclosure: vi.fn().mockResolvedValue(undefined),
  setGrant: vi.fn().mockResolvedValue(undefined),
  setRevocationIfNotRevoked: vi
    .fn()
    .mockResolvedValue({ wasNewlyRevoked: true, existingRevokedAt: null }),
  clearConsentTimestamps: vi
    .fn()
    .mockResolvedValue({ previousGrantedAt: null, previousRevokedAt: null }),
});

describe("ConsentService — ContactNotFound paths", () => {
  it("recordDisclosureShown throws ContactNotFound on missing contact", async () => {
    const { service } = ctx({ store: buildNullStore() });
    await expect(
      service.recordDisclosureShown({
        contactId: "missing",
        jurisdiction: "SG",
        version: "sg-disclosure@1.0.0",
        shownAt: new Date(),
        actor: "system:skill_runtime",
        organizationId: "org1",
      }),
    ).rejects.toBeInstanceOf(ContactNotFound);
  });

  it("recordGrant throws ContactNotFound on missing contact", async () => {
    const { service } = ctx({ store: buildNullStore() });
    await expect(
      service.recordGrant({
        contactId: "missing",
        jurisdiction: "MY",
        source: "operator_recorded",
        grantedAt: new Date(),
        actor: "user_42",
      }),
    ).rejects.toBeInstanceOf(ContactNotFound);
  });

  it("recordRevocation throws ContactNotFound on missing contact", async () => {
    const { service } = ctx({ store: buildNullStore() });
    await expect(
      service.recordRevocation({
        contactId: "missing",
        source: "inbound_keyword_revocation",
        revokedAt: new Date(),
        actor: "system:inbound_keyword_revocation",
      }),
    ).rejects.toBeInstanceOf(ContactNotFound);
  });

  it("clearConsent throws ContactNotFound on missing contact", async () => {
    const { service } = ctx({ store: buildNullStore() });
    await expect(
      service.clearConsent({
        contactId: "missing",
        actor: "user_42",
        notes: "operator reset",
      }),
    ).rejects.toBeInstanceOf(ContactNotFound);
  });
});
