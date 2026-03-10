// ---------------------------------------------------------------------------
// LLMClient — Typed interface for structured LLM calls
// ---------------------------------------------------------------------------
// Provides a contract for LLM interactions used by the revenue-growth
// cartridge (artifact generation, digest writing) and potentially other
// components needing structured LLM output.
// ---------------------------------------------------------------------------

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompletionOptions {
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature (0-1) for creativity control */
  temperature?: number;
  /** Stop sequences */
  stop?: string[];
}

/** Generic schema validator — compatible with Zod schemas (.parse()) */
export interface SchemaValidator<T> {
  parse(data: unknown): T;
}

export interface LLMClient {
  /** Generate a plain text completion */
  complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<string>;

  /** Generate a structured completion validated against a schema */
  completeStructured<T>(
    messages: LLMMessage[],
    schema: SchemaValidator<T>,
    options?: LLMCompletionOptions,
  ): Promise<T>;
}

// ---------------------------------------------------------------------------
// MockLLMClient — For testing
// ---------------------------------------------------------------------------

export class MockLLMClient implements LLMClient {
  private responses: string[] = [];
  private callIndex = 0;

  constructor(responses: string[] = ["Mock LLM response"]) {
    this.responses = responses;
  }

  async complete(_messages: LLMMessage[], _options?: LLMCompletionOptions): Promise<string> {
    const response = this.responses[this.callIndex % this.responses.length] ?? "Mock response";
    this.callIndex++;
    return response;
  }

  async completeStructured<T>(
    _messages: LLMMessage[],
    schema: SchemaValidator<T>,
    _options?: LLMCompletionOptions,
  ): Promise<T> {
    // Return the first response parsed through the schema
    const response = this.responses[this.callIndex % this.responses.length] ?? "{}";
    this.callIndex++;
    return schema.parse(JSON.parse(response));
  }
}
