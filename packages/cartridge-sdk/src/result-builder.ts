import type { UndoRecipe } from "@switchboard/schemas";
import type { ExecuteResult } from "./cartridge.js";

/**
 * Builder for constructing ExecuteResult objects with sensible defaults.
 * Reduces boilerplate in cartridge action handlers.
 */
export class ExecuteResultBuilder {
  private _success = true;
  private _summary = "";
  private _externalRefs: Record<string, string> = {};
  private _rollbackAvailable = false;
  private _partialFailures: Array<{ step: string; error: string }> = [];
  private _undoRecipe: UndoRecipe | null = null;
  private _data: unknown = undefined;
  private _startTime: number;

  constructor(startTime?: number) {
    this._startTime = startTime ?? Date.now();
  }

  /** Create a builder initialized to the current timestamp. */
  static start(): ExecuteResultBuilder {
    return new ExecuteResultBuilder(Date.now());
  }

  success(summary: string): this {
    this._success = true;
    this._summary = summary;
    return this;
  }

  failure(summary: string): this {
    this._success = false;
    this._summary = summary;
    return this;
  }

  refs(externalRefs: Record<string, string>): this {
    this._externalRefs = { ...this._externalRefs, ...externalRefs };
    return this;
  }

  rollback(available: boolean): this {
    this._rollbackAvailable = available;
    return this;
  }

  undo(recipe: UndoRecipe | null): this {
    this._undoRecipe = recipe;
    if (recipe) this._rollbackAvailable = true;
    return this;
  }

  data(value: unknown): this {
    this._data = value;
    return this;
  }

  addFailure(step: string, error: string): this {
    this._partialFailures.push({ step, error });
    return this;
  }

  build(): ExecuteResult {
    const result: ExecuteResult = {
      success: this._success,
      summary: this._summary,
      externalRefs: this._externalRefs,
      rollbackAvailable: this._rollbackAvailable,
      partialFailures: this._partialFailures,
      durationMs: Date.now() - this._startTime,
      undoRecipe: this._undoRecipe,
    };
    if (this._data !== undefined) {
      result.data = this._data;
    }
    return result;
  }
}

/** Shorthand for a failed ExecuteResult with a validation error. */
export function failResult(start: number, message: string, step = "validate"): ExecuteResult {
  return new ExecuteResultBuilder(start).failure(message).addFailure(step, message).build();
}
