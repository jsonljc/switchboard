/**
 * Cartridge interface types — moved from cartridge-sdk to schemas (Layer 1)
 * so that employee-sdk (Layer 2) can import them without depending on cartridge-sdk.
 *
 * Runtime code (builders, validators, helpers) stays in cartridge-sdk.
 */

import type { CartridgeManifest, ConnectionHealth, GuardrailConfig } from "./cartridge.js";
import type { RiskInput } from "./risk.js";
import type { UndoRecipe } from "./undo.js";
import type { ResolvedEntity } from "./resolver.js";

// ---------------------------------------------------------------------------
// ExecuteResult
// ---------------------------------------------------------------------------

export interface ExecuteResult {
  success: boolean;
  summary: string;
  externalRefs: Record<string, string>;
  rollbackAvailable: boolean;
  partialFailures: Array<{ step: string; error: string }>;
  durationMs: number;
  undoRecipe: UndoRecipe | null;
  /** Structured result data (e.g. diagnostic payloads) that passes through governance. */
  data?: unknown;
}

// ---------------------------------------------------------------------------
// CartridgeContext
// ---------------------------------------------------------------------------

export interface CartridgeContext {
  principalId: string;
  organizationId: string | null;
  connectionCredentials: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Cartridge
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CartridgeInterceptor
// ---------------------------------------------------------------------------

/**
 * Interceptor interface for cross-cutting concerns that apply to specific cartridges.
 * Interceptors are composed externally at registration time -- cartridges themselves
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

// ---------------------------------------------------------------------------
// ConnectionContract
// ---------------------------------------------------------------------------

export interface ConnectionContract {
  serviceId: string;
  serviceName: string;
  authType: "oauth2" | "api_key" | "service_account";
  requiredScopes: string[];
  refreshStrategy: "auto" | "manual" | "none";
  healthCheck(): Promise<ConnectionHealth>;
}
