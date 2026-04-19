import type { ExecutionMode, ExecutionContext } from "./execution-context.js";
import type { ExecutionConstraints } from "./governance-types.js";
import type { ExecutionResult } from "./execution-result.js";
import type { WorkUnit } from "./work-unit.js";

export class ExecutionModeRegistry {
  private modes = new Map<string, ExecutionMode>();

  register(mode: ExecutionMode): void {
    if (this.modes.has(mode.name)) {
      throw new Error(`Execution mode already registered: ${mode.name}`);
    }
    this.modes.set(mode.name, mode);
  }

  async dispatch(
    modeName: string,
    workUnit: WorkUnit,
    constraints: ExecutionConstraints,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const mode = this.modes.get(modeName);
    if (!mode) {
      throw new Error(`Unknown execution mode: ${modeName}`);
    }
    console.warn(
      `[ModeRegistry] dispatch mode=${modeName} intent=${workUnit.intent} org=${workUnit.organizationId}`,
    );
    return mode.execute(workUnit, constraints, context);
  }

  hasMode(name: string): boolean {
    return this.modes.has(name);
  }

  listModes(): string[] {
    return [...this.modes.keys()].sort();
  }
}
