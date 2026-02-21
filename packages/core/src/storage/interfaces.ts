import type {
  ActionEnvelope,
  Policy,
  IdentitySpec,
  RoleOverlay,
  ApprovalRequest,
} from "@switchboard/schemas";
import type { ApprovalState } from "../approval/state-machine.js";
import type { Cartridge } from "@switchboard/cartridge-sdk";

export interface EnvelopeStore {
  save(envelope: ActionEnvelope): Promise<void>;
  getById(id: string): Promise<ActionEnvelope | null>;
  update(id: string, updates: Partial<ActionEnvelope>): Promise<void>;
  list(filter?: {
    principalId?: string;
    status?: string;
    limit?: number;
  }): Promise<ActionEnvelope[]>;
}

export interface PolicyStore {
  save(policy: Policy): Promise<void>;
  getById(id: string): Promise<Policy | null>;
  update(id: string, data: Partial<Policy>): Promise<void>;
  delete(id: string): Promise<boolean>;
  listActive(filter?: { cartridgeId?: string }): Promise<Policy[]>;
}

export interface IdentityStore {
  saveSpec(spec: IdentitySpec): Promise<void>;
  getSpecByPrincipalId(principalId: string): Promise<IdentitySpec | null>;
  getSpecById(id: string): Promise<IdentitySpec | null>;
  listOverlaysBySpecId(specId: string): Promise<RoleOverlay[]>;
  saveOverlay(overlay: RoleOverlay): Promise<void>;
}

export interface ApprovalStore {
  save(approval: {
    request: ApprovalRequest;
    state: ApprovalState;
    envelopeId: string;
  }): Promise<void>;
  getById(id: string): Promise<{
    request: ApprovalRequest;
    state: ApprovalState;
    envelopeId: string;
  } | null>;
  updateState(id: string, state: ApprovalState): Promise<void>;
  listPending(): Promise<
    Array<{
      request: ApprovalRequest;
      state: ApprovalState;
      envelopeId: string;
    }>
  >;
}

export interface CartridgeRegistry {
  register(cartridgeId: string, cartridge: Cartridge): void;
  get(cartridgeId: string): Cartridge | null;
  list(): string[];
}

export interface StorageContext {
  envelopes: EnvelopeStore;
  policies: PolicyStore;
  identity: IdentityStore;
  approvals: ApprovalStore;
  cartridges: CartridgeRegistry;
}
