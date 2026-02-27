import {
  GuardrailConfigSchema,
  RiskInputSchema,
  ConnectionHealthSchema,
} from "@switchboard/schemas";
import type { Cartridge, CartridgeContext } from "./cartridge.js";
import { validateManifest } from "./validation.js";

export interface HarnessStepResult {
  step: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface HarnessReport {
  cartridgeId: string;
  passed: boolean;
  steps: HarnessStepResult[];
  totalDurationMs: number;
}

export interface HarnessOptions {
  context?: CartridgeContext;
  actionType?: string;
  parameters?: Record<string, unknown>;
  skipExecute?: boolean;
}

const DEFAULT_CONTEXT: CartridgeContext = {
  principalId: "test-harness",
  organizationId: null,
  connectionCredentials: {},
};

async function runStep(
  name: string,
  fn: () => Promise<void> | void,
): Promise<HarnessStepResult> {
  const start = performance.now();
  try {
    await fn();
    return { step: name, passed: true, durationMs: performance.now() - start };
  } catch (e) {
    return {
      step: name,
      passed: false,
      durationMs: performance.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export class CartridgeTestHarness {
  private readonly cartridge: Cartridge;
  private readonly context: CartridgeContext;
  private readonly actionType: string;
  private readonly parameters: Record<string, unknown>;
  private readonly skipExecute: boolean;

  constructor(cartridge: Cartridge, options?: HarnessOptions) {
    this.cartridge = cartridge;
    this.context = options?.context ?? DEFAULT_CONTEXT;
    this.actionType =
      options?.actionType ?? cartridge.manifest.actions[0]?.actionType ?? "";
    this.parameters = options?.parameters ?? {};
    this.skipExecute = options?.skipExecute ?? false;
  }

  async run(): Promise<HarnessReport> {
    const totalStart = performance.now();
    const steps: HarnessStepResult[] = [];

    // 1. validate-manifest
    steps.push(
      await runStep("validate-manifest", () => {
        const result = validateManifest(this.cartridge.manifest);
        if (!result.valid) {
          throw new Error(
            `Manifest validation failed: ${result.errors.map((e) => e.message).join("; ")}`,
          );
        }
      }),
    );

    // 2. initialize
    steps.push(
      await runStep("initialize", async () => {
        await this.cartridge.initialize(this.context);
      }),
    );

    // 3. enrich-context
    steps.push(
      await runStep("enrich-context", async () => {
        const enriched = await this.cartridge.enrichContext(
          this.actionType,
          this.parameters,
          this.context,
        );
        if (!enriched || typeof enriched !== "object") {
          throw new Error("enrichContext must return an object");
        }
      }),
    );

    // 4. get-risk-input
    steps.push(
      await runStep("get-risk-input", async () => {
        const riskInput = await this.cartridge.getRiskInput(
          this.actionType,
          this.parameters,
          {},
        );
        const parseResult = RiskInputSchema.safeParse(riskInput);
        if (!parseResult.success) {
          throw new Error(
            `RiskInput schema validation failed: ${parseResult.error.message}`,
          );
        }
      }),
    );

    // 5. get-guardrails
    steps.push(
      await runStep("get-guardrails", () => {
        const guardrails = this.cartridge.getGuardrails();
        const parseResult = GuardrailConfigSchema.safeParse(guardrails);
        if (!parseResult.success) {
          throw new Error(
            `GuardrailConfig schema validation failed: ${parseResult.error.message}`,
          );
        }
      }),
    );

    // 6. execute (optional skip)
    if (!this.skipExecute) {
      steps.push(
        await runStep("execute", async () => {
          const result = await this.cartridge.execute(
            this.actionType,
            this.parameters,
            this.context,
          );
          if (typeof result.success !== "boolean") {
            throw new Error("execute result must have a boolean 'success' field");
          }
          if (typeof result.summary !== "string") {
            throw new Error("execute result must have a string 'summary' field");
          }
          if (!result.externalRefs || typeof result.externalRefs !== "object") {
            throw new Error("execute result must have an 'externalRefs' object");
          }
          if (!Array.isArray(result.partialFailures)) {
            throw new Error("execute result must have a 'partialFailures' array");
          }
          if (typeof result.durationMs !== "number") {
            throw new Error("execute result must have a numeric 'durationMs' field");
          }
        }),
      );
    }

    // 7. health-check
    steps.push(
      await runStep("health-check", async () => {
        const health = await this.cartridge.healthCheck();
        const parseResult = ConnectionHealthSchema.safeParse(health);
        if (!parseResult.success) {
          throw new Error(
            `ConnectionHealth schema validation failed: ${parseResult.error.message}`,
          );
        }
      }),
    );

    // 8. capture-snapshot (only if method exists)
    if (typeof this.cartridge.captureSnapshot === "function") {
      steps.push(
        await runStep("capture-snapshot", async () => {
          const snapshot = await this.cartridge.captureSnapshot!(
            this.actionType,
            this.parameters,
            this.context,
          );
          if (!snapshot || typeof snapshot !== "object") {
            throw new Error("captureSnapshot must return an object");
          }
        }),
      );
    }

    const totalDurationMs = performance.now() - totalStart;
    const passed = steps.every((s) => s.passed);

    return {
      cartridgeId: this.cartridge.manifest.id,
      passed,
      steps,
      totalDurationMs,
    };
  }

  async runOrThrow(): Promise<HarnessReport> {
    const report = await this.run();
    if (!report.passed) {
      const failures = report.steps
        .filter((s) => !s.passed)
        .map((s) => `  - ${s.step}: ${s.error ?? "unknown error"}`)
        .join("\n");
      throw new Error(
        `CartridgeTestHarness: ${report.cartridgeId} failed steps:\n${failures}`,
      );
    }
    return report;
  }
}
