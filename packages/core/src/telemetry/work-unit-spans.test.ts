import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Span, Tracer } from "./tracing.js";
import { projectWorkUnitSpans, type WorkUnitSpanInput } from "./work-unit-spans.js";

interface RecordedSpan {
  id: number;
  name: string;
  attributes: Record<string, string | number | boolean>;
  parentId: number | null;
  status?: { code: "OK" | "ERROR"; message?: string };
  ended: boolean;
}

class RecordingTracer implements Tracer {
  readonly spans: RecordedSpan[] = [];
  private byWrapper = new WeakMap<Span, RecordedSpan>();
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parent?: Span,
  ): Span {
    const rec: RecordedSpan = {
      id: this.spans.length,
      name,
      attributes: { ...(attributes ?? {}) },
      parentId: parent ? (this.byWrapper.get(parent)?.id ?? null) : null,
      ended: false,
    };
    this.spans.push(rec);
    const span: Span = {
      setAttribute: (k, v) => {
        rec.attributes[k] = v;
      },
      setStatus: (code, message) => {
        rec.status = { code, message };
      },
      end: () => {
        rec.ended = true;
      },
    };
    this.byWrapper.set(span, rec);
    return span;
  }
}

function sampleInput(): WorkUnitSpanInput {
  const tool = (toolId: string) => ({
    toolId,
    operation: "create",
    params: {},
    result: { status: "success" as const },
    durationMs: 5,
    governanceDecision: "auto-approved" as const,
  });
  return {
    workUnit: { workUnitId: "wu_1", organizationId: "org_1", deploymentId: "dep_1" },
    executions: [
      {
        skillSlug: "alex",
        status: "success",
        durationMs: 10,
        turnCount: 2,
        toolCalls: [tool("book"), tool("notify")],
      },
      {
        skillSlug: "alex",
        status: "success",
        durationMs: 8,
        turnCount: 1,
        toolCalls: [tool("log")],
      },
    ],
  };
}

describe("projectWorkUnitSpans — tree structure", () => {
  it("emits a parented work-unit -> execution -> tool tree, all ended", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(sampleInput(), tracer);

    const root = tracer.spans.filter((s) => s.parentId === null);
    expect(root).toHaveLength(1);
    expect(root[0]!.attributes["switchboard.work_unit.id"]).toBe("wu_1");

    const executions = tracer.spans.filter((s) => s.parentId === root[0]!.id);
    expect(executions).toHaveLength(2);

    const toolsOfFirst = tracer.spans.filter((s) => s.parentId === executions[0]!.id);
    expect(toolsOfFirst).toHaveLength(2);
    const toolsOfSecond = tracer.spans.filter((s) => s.parentId === executions[1]!.id);
    expect(toolsOfSecond).toHaveLength(1);

    expect(tracer.spans).toHaveLength(1 + 2 + 3);
    expect(tracer.spans.every((s) => s.ended)).toBe(true);
  });

  it("emits only the work-unit span when there are no executions", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans({ workUnit: { workUnitId: "wu_empty" }, executions: [] }, tracer);
    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0]!.parentId).toBeNull();
    expect(tracer.spans[0]!.ended).toBe(true);
  });
});

describe("projectWorkUnitSpans — GenAI attributes, status, guards, privacy", () => {
  it("maps GenAI + switchboard attributes on each span level", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: {
          workUnitId: "wu_1",
          organizationId: "org_1",
          deploymentId: "dep_1",
          intent: "book_appointment",
          governanceOutcome: "require_approval",
          outcome: "succeeded",
          riskScore: 0.4,
          durationMs: 120,
        },
        executions: [
          {
            skillSlug: "alex",
            skillVersion: "3",
            sessionId: "sess_9",
            status: "success",
            durationMs: 100,
            turnCount: 3,
            model: "claude-opus-4-6",
            inputTokens: 1200,
            outputTokens: 340,
            toolCalls: [
              {
                toolId: "book_appointment",
                operation: "create",
                params: { customerPhone: "+6591234567", depositRef: "DEP-SECRET-XYZ" },
                result: { status: "success" },
                durationMs: 12,
                governanceDecision: "auto-approved",
              },
            ],
          },
        ],
      },
      tracer,
    );

    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect(root.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
    expect(root.attributes["gen_ai.system"]).toBe("switchboard");
    expect(root.attributes["switchboard.intent"]).toBe("book_appointment");
    expect(root.attributes["switchboard.governance.outcome"]).toBe("require_approval");
    expect(root.attributes["switchboard.work.outcome"]).toBe("succeeded");
    expect(root.attributes["switchboard.risk_score"]).toBe(0.4);
    expect(root.attributes["switchboard.duration_ms"]).toBe(120);

    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect(exec.attributes["gen_ai.operation.name"]).toBe("chat");
    expect(exec.attributes["gen_ai.request.model"]).toBe("claude-opus-4-6");
    expect(exec.attributes["gen_ai.usage.input_tokens"]).toBe(1200);
    expect(exec.attributes["gen_ai.usage.output_tokens"]).toBe(340);
    expect(exec.attributes["switchboard.skill.slug"]).toBe("alex");
    expect(exec.attributes["switchboard.turn_count"]).toBe(3);
    expect(exec.status?.code).toBe("OK");

    const tool = tracer.spans.find((s) => s.name.startsWith("execute_tool"))!;
    expect(tool.attributes["gen_ai.operation.name"]).toBe("execute_tool");
    expect(tool.attributes["gen_ai.tool.name"]).toBe("book_appointment");
    expect(tool.attributes["switchboard.tool.operation"]).toBe("create");
    expect(tool.attributes["switchboard.governance.decision"]).toBe("auto-approved");
    expect(tool.attributes["switchboard.tool.result_status"]).toBe("success");
    expect(tool.attributes["switchboard.tool.duration_ms"]).toBe(12);
  });

  it("never writes raw param VALUES to any span (privacy); records presence only", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1" },
        executions: [
          {
            toolCalls: [
              {
                toolId: "t",
                operation: "op",
                params: { customerPhone: "+6591234567", depositRef: "DEP-SECRET-XYZ" },
                result: { status: "success" },
                durationMs: 1,
                governanceDecision: "auto-approved",
              },
            ],
          },
        ],
      },
      tracer,
    );
    const allValues = tracer.spans
      .flatMap((s) => Object.values(s.attributes))
      .map(String)
      .join("|");
    expect(allValues).not.toContain("+6591234567");
    expect(allValues).not.toContain("DEP-SECRET-XYZ");
    const tool = tracer.spans.find((s) => s.name.startsWith("execute_tool"))!;
    expect(tool.attributes["switchboard.tool.params_present"]).toBe(true);
  });

  it("sets ERROR status for denied governance / error+denied tool results", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1", governanceOutcome: "deny", outcome: "failed" },
        executions: [
          {
            status: "error",
            toolCalls: [
              {
                toolId: "t1",
                operation: "o",
                params: {},
                result: { status: "denied" },
                durationMs: 1,
                governanceDecision: "denied",
              },
              {
                toolId: "t2",
                operation: "o",
                params: {},
                result: { status: "pending_approval" },
                durationMs: 1,
                governanceDecision: "require-approval",
              },
            ],
          },
        ],
      },
      tracer,
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect(root.status?.code).toBe("ERROR");
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect(exec.status?.code).toBe("ERROR");
    const denied = tracer.spans.find((s) => s.name === "execute_tool t1")!;
    expect(denied.status?.code).toBe("ERROR");
    const pending = tracer.spans.find((s) => s.name === "execute_tool t2")!;
    expect(pending.status?.code).toBe("OK"); // pending_approval is a parked state, not a failure
  });

  it("guards non-finite numbers (NaN/Infinity skipped, not written)", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1", riskScore: Number.NaN, durationMs: Infinity },
        executions: [{ durationMs: Number.NaN, inputTokens: Number.NaN, toolCalls: [] }],
      },
      tracer,
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect("switchboard.risk_score" in root.attributes).toBe(false);
    expect("switchboard.duration_ms" in root.attributes).toBe(false);
  });

  it("fails SOFT on a malformed tool record (marker attribute, no throw)", () => {
    const tracer = new RecordingTracer();
    const input = {
      workUnit: { workUnitId: "wu_1" },
      executions: [{ toolCalls: [null, { toolId: 42 }] as unknown as ReadonlyArray<never> }],
    } as unknown as WorkUnitSpanInput;
    expect(() => projectWorkUnitSpans(input, tracer)).not.toThrow();
    const malformed = tracer.spans.filter(
      (s) => s.attributes["switchboard.tool.malformed"] === true,
    );
    expect(malformed.length).toBeGreaterThanOrEqual(1);
    expect(malformed.every((s) => s.ended)).toBe(true);
  });

  it("is read-only: does not mutate a deep-frozen input (one-directionality)", () => {
    const tracer = new RecordingTracer();
    const input: WorkUnitSpanInput = {
      workUnit: Object.freeze({ workUnitId: "wu_1" }),
      executions: Object.freeze([
        Object.freeze({
          toolCalls: Object.freeze([
            Object.freeze({
              toolId: "t",
              operation: "o",
              params: Object.freeze({}),
              result: Object.freeze({ status: "success" as const }),
              durationMs: 1,
              governanceDecision: "auto-approved" as const,
            }),
          ]),
        }),
      ]),
    } as WorkUnitSpanInput;
    expect(() => projectWorkUnitSpans(input, tracer)).not.toThrow();
  });
});

it("the projection module imports nothing from the db layer (one-directional)", () => {
  const src = readFileSync(fileURLToPath(new URL("./work-unit-spans.ts", import.meta.url)), "utf8");
  expect(src).not.toMatch(/@switchboard\/db/);
  expect(src).not.toMatch(/from\s+["'].*\/db\//);
});
