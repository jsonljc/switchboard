import type { AgentHandler } from "../handler.js";
import type { AgentPersona } from "../context.js";
import { TestChatSession } from "./test-session.js";
import type { ChatSessionOptions } from "./test-session.js";

export interface TestHarnessConfig {
  handler: AgentHandler;
  persona: AgentPersona;
}

export interface TestHarness {
  chat(options?: ChatSessionOptions): TestChatSession;
}

export function createTestHarness(config: TestHarnessConfig): TestHarness {
  return {
    chat(options?: ChatSessionOptions): TestChatSession {
      return new TestChatSession(config.handler, config.persona, options);
    },
  };
}

export function mockPersona(overrides?: Partial<AgentPersona>): AgentPersona {
  return {
    id: "test-persona",
    organizationId: "test-org",
    businessName: "Test Business",
    businessType: "small_business",
    productService: "Test products and services",
    valueProposition: "The best test business",
    tone: "professional",
    qualificationCriteria: {},
    disqualificationCriteria: {},
    bookingLink: null,
    escalationRules: {},
    customInstructions: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export { TestChatSession } from "./test-session.js";
export type { ChatSessionOptions } from "./test-session.js";
export {
  InMemoryStateStore,
  MockFileProvider,
  MockBrowserProvider,
  MockLLMProvider,
} from "./mock-providers.js";
