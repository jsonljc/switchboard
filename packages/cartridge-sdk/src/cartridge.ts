import type {
  CartridgeManifest,
  ConnectionHealth,
  GuardrailConfig,
  RiskInput,
  UndoRecipe,
  ResolvedEntity,
} from "@switchboard/schemas";

export interface ExecuteResult {
  success: boolean;
  summary: string;
  externalRefs: Record<string, string>;
  rollbackAvailable: boolean;
  partialFailures: Array<{ step: string; error: string }>;
  durationMs: number;
  undoRecipe: UndoRecipe | null;
}

export interface CartridgeContext {
  principalId: string;
  organizationId: string | null;
  connectionCredentials: Record<string, unknown>;
}

export interface Cartridge {
  readonly manifest: CartridgeManifest;

  initialize(context: CartridgeContext): Promise<void>;

  enrichContext(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<Record<string, unknown>>;

  execute(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<ExecuteResult>;

  getRiskInput(
    actionType: string,
    parameters: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<RiskInput>;

  getGuardrails(): GuardrailConfig;

  healthCheck(): Promise<ConnectionHealth>;

  searchCampaigns?(query: string): Promise<Array<{ id: string; name: string; status: string }>>;

  /** Resolve a user-provided reference (e.g. campaign name) to a concrete entity. Optional. */
  resolveEntity?(
    inputRef: string,
    entityType: string,
    context: Record<string, unknown>,
  ): Promise<ResolvedEntity>;

  /** Capture external entity state before mutation for audit/forensics. Optional. */
  captureSnapshot?(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<Record<string, unknown>>;
}

/**
 * Interceptor interface for cross-cutting concerns that apply to specific cartridges.
 * Interceptors are composed externally at registration time — cartridges themselves
 * don't implement interceptors. The GuardedCartridge wrapper runs the interceptor chain.
 *
 * Use cases:
 * - `beforeEnrich`: Parameter redaction before enrichment (e.g. HIPAA PII removal)
 * - `beforeExecute`: Shadow execution / dry-run gates (e.g. K8s blast radius check)
 * - `afterExecute`: Result transformation or audit decoration
 */
export interface CartridgeInterceptor {
  beforeEnrich?(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<{ parameters: Record<string, unknown> }>;

  beforeExecute?(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<{ proceed: boolean; parameters: Record<string, unknown>; reason?: string }>;

  afterExecute?(
    actionType: string,
    parameters: Record<string, unknown>,
    result: ExecuteResult,
    context: CartridgeContext,
  ): Promise<ExecuteResult>;
}
