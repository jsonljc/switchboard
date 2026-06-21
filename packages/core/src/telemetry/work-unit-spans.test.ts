import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Span, SpanStartOptions, Tracer } from "./tracing.js";
import { projectWorkUnitSpans, type WorkUnitSpanInput } from "./work-unit-spans.js";

interface RecordedSpan {
  id: number;
  name: string;
  attributes: Record<string, string | number | boolean>;
  parentId: number | null;
  status?: { code: "OK" | "ERROR"; message?: string };
  ended: boolean;
  kind?: number;
  startTimeMs?: number;
  endTimeMs?: number;
}

class RecordingTracer implements Tracer {
  readonly spans: RecordedSpan[] = [];
  private byWrapper = new WeakMap<Span, RecordedSpan>();
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parent?: Span,
    options?: SpanStartOptions,
  ): Span {
    const rec: RecordedSpan = {
      id: this.spans.length,
      name,
      attributes: { ...(attributes ?? {}) },
      parentId: parent ? (this.byWrapper.get(parent)?.id ?? null) : null,
      ended: false,
      kind: options?.kind,
      startTimeMs: options?.startTime,
    };
    this.spans.push(rec);
    const span: Span = {
      setAttribute: (k, v) => {
        rec.attributes[k] = v;
      },
      setStatus: (code, message) => {
        rec.status = { code, message };
      },
      end: (endTime?: number) => {
        rec.ended = true;
        rec.endTimeMs = endTime;
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
    expect("gen_ai.system" in root.attributes).toBe(false);
    expect(root.attributes["gen_ai.provider.name"]).toBe("anthropic");
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

describe("projectWorkUnitSpans — honest timing + SpanKind (E4c)", () => {
  const T0 = 1_700_000_000_000;

  it("work-unit span carries REAL requestedAt/completedAt times + INTERNAL kind", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: {
          workUnitId: "wu_1",
          requestedAtMs: T0,
          completedAtMs: T0 + 120,
          durationMs: 120,
        },
        executions: [],
      },
      tracer,
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect(root.startTimeMs).toBe(T0);
    expect(root.endTimeMs).toBe(T0 + 120);
    expect(root.kind).toBe(0); // INTERNAL
    expect("switchboard.timing.synthetic" in root.attributes).toBe(false); // real, not marked
  });

  it("work-unit end falls back to requestedAt + durationMs when completedAt is absent", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      { workUnit: { workUnitId: "wu_1", requestedAtMs: T0, durationMs: 90 }, executions: [] },
      tracer,
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect(root.endTimeMs).toBe(T0 + 90);
  });

  it("execution span: end = createdAt, start = createdAt - durationMs, CLIENT kind, marked synthetic", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1", requestedAtMs: T0 },
        executions: [{ skillSlug: "alex", createdAtMs: T0 + 100, durationMs: 40, toolCalls: [] }],
      },
      tracer,
    );
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect(exec.startTimeMs).toBe(T0 + 60);
    expect(exec.endTimeMs).toBe(T0 + 100);
    expect(exec.kind).toBe(2); // CLIENT
    expect(exec.attributes["switchboard.timing.synthetic"]).toBe(true);
  });

  it("tool spans pack sequentially within the exec window, INTERNAL kind, marked synthetic", () => {
    const tracer = new RecordingTracer();
    const tool = (toolId: string, durationMs: number) => ({
      toolId,
      operation: "op",
      params: {},
      result: { status: "success" as const },
      durationMs,
      governanceDecision: "auto-approved" as const,
    });
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1" },
        executions: [
          {
            createdAtMs: T0 + 100,
            durationMs: 50,
            toolCalls: [tool("book", 10), tool("notify", 15)],
          },
        ],
      },
      tracer,
    );
    // execStart = (T0+100) - 50 = T0+50
    const t0 = tracer.spans.find((s) => s.name === "execute_tool book")!;
    const t1 = tracer.spans.find((s) => s.name === "execute_tool notify")!;
    expect(t0.startTimeMs).toBe(T0 + 50);
    expect(t0.endTimeMs).toBe(T0 + 60);
    expect(t1.startTimeMs).toBe(T0 + 60);
    expect(t1.endTimeMs).toBe(T0 + 75);
    expect(t0.kind).toBe(0);
    expect(t0.attributes["switchboard.timing.synthetic"]).toBe(true);
    expect(t1.attributes["switchboard.timing.synthetic"]).toBe(true);
  });

  it("degrades to no explicit times (E4b flat) when anchors are missing — structure preserved", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1" },
        executions: [{ skillSlug: "a", durationMs: 10, toolCalls: [] }],
      },
      tracer,
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect(root.startTimeMs).toBeUndefined();
    expect(exec.startTimeMs).toBeUndefined();
    expect("switchboard.timing.synthetic" in exec.attributes).toBe(false); // nothing synthesized -> not marked
    expect(tracer.spans.every((s) => s.ended)).toBe(true);
  });

  it("guards the root work_unit.id with setIfString (empty id -> attribute absent)", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans({ workUnit: { workUnitId: "" }, executions: [] }, tracer);
    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect("switchboard.work_unit.id" in root.attributes).toBe(false);
  });
});

import type { OTelContextBridge, SpanStartOptions as SpanStartOptionsFromBarrel } from "./index.js";

describe("projectWorkUnitSpans — cache/cost + provider attributes (E4c)", () => {
  it("maps cache token + cost attributes on the execution span", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1" },
        executions: [
          {
            skillSlug: "alex",
            model: "claude-opus-4-6",
            cacheReadTokens: 900,
            cacheCreationTokens: 100,
            costUsd: 0.012,
            toolCalls: [],
          },
        ],
      },
      tracer,
    );
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect(exec.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(900);
    expect(exec.attributes["gen_ai.usage.cache_creation_input_tokens"]).toBe(100);
    expect(exec.attributes["switchboard.cost_usd"]).toBe(0.012);
    expect(exec.attributes["gen_ai.provider.name"]).toBe("anthropic");
  });

  it("omits gen_ai.provider.name when the model is not a Claude model", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      { workUnit: { workUnitId: "wu_1" }, executions: [{ model: "gpt-4o", toolCalls: [] }] },
      tracer,
    );
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect("gen_ai.provider.name" in exec.attributes).toBe(false);
  });
});

describe("telemetry barrel (E4c)", () => {
  it("re-exports OTelContextBridge + SpanStartOptions types", () => {
    const bridge: OTelContextBridge = { active: () => null, with: (_c, _s) => null };
    const opts: SpanStartOptionsFromBarrel = { startTime: 1, kind: 0 };
    expect(typeof bridge.active).toBe("function");
    expect(opts.kind).toBe(0);
  });
});

describe("projectWorkUnitSpans — E4c-hardening (throw-safety + symmetric timing + geometry clamps)", () => {
  const T0 = 1_700_000_000_000;

  it("does not throw when executions is not an array", () => {
    const tracer = new RecordingTracer();
    const input = { workUnit: { workUnitId: "wu" }, executions: null } as any;
    expect(() => projectWorkUnitSpans(input, tracer)).not.toThrow();
    // exactly 1 span = the root (no executions iterated)
    expect(tracer.spans).toHaveLength(1);
  });

  it("does not throw when toolCalls is a non-array", () => {
    const tracer = new RecordingTracer();
    const input = {
      workUnit: { workUnitId: "wu" },
      executions: [{ toolCalls: { not: "an array" } }],
    } as any;
    expect(() => projectWorkUnitSpans(input, tracer)).not.toThrow();
    // exec span present
    expect(tracer.spans.some((s) => s.name.startsWith("chat"))).toBe(true);
    // 0 tool spans (toolCalls was not iterated)
    expect(tracer.spans.filter((s) => s.name.startsWith("execute_tool"))).toHaveLength(0);
  });

  it("root degrades FULLY flat when end is underivable (symmetric)", () => {
    const tracer = new RecordingTracer();
    // requestedAtMs present but no completedAtMs / durationMs -> end underivable
    projectWorkUnitSpans(
      { workUnit: { workUnitId: "wu", requestedAtMs: T0 }, executions: [] },
      tracer,
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    // symmetric: BOTH must be undefined (not start-only)
    expect(root.startTimeMs).toBeUndefined();
    expect(root.endTimeMs).toBeUndefined();
  });

  it("execution degrades FULLY flat when durationMs absent (symmetric)", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu" },
        executions: [{ createdAtMs: T0 + 100, toolCalls: [] }],
      },
      tracer,
    );
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect(exec.startTimeMs).toBeUndefined();
    expect(exec.endTimeMs).toBeUndefined();
  });

  it("tool end is clamped to execution end (no child-exceeds-parent)", () => {
    const tracer = new RecordingTracer();
    // execStart = T0+70, execEnd = T0+100 (window = 30ms)
    // tool(25) + tool(25) = 50ms total > 30ms window -> second tool must be clamped
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu" },
        executions: [
          {
            createdAtMs: T0 + 100,
            durationMs: 30,
            toolCalls: [
              {
                toolId: "t1",
                operation: "o",
                params: {},
                result: { status: "success" },
                durationMs: 25,
                governanceDecision: "auto-approved",
              },
              {
                toolId: "t2",
                operation: "o",
                params: {},
                result: { status: "success" },
                durationMs: 25,
                governanceDecision: "auto-approved",
              },
            ],
          },
        ],
      },
      tracer,
    );
    const execEnd = T0 + 100;
    const tools = tracer.spans.filter((s) => s.name.startsWith("execute_tool"));
    expect(tools).toHaveLength(2);
    // every tool's endTimeMs must be <= execEnd
    for (const t of tools) {
      expect(t.endTimeMs!).toBeLessThanOrEqual(execEnd);
    }
    // every tool's startTimeMs must be >= execStart (T0+70) and <= execEnd
    const execStart = T0 + 70;
    for (const t of tools) {
      expect(t.startTimeMs!).toBeGreaterThanOrEqual(execStart);
      expect(t.startTimeMs!).toBeLessThanOrEqual(execEnd);
    }
  });

  it("execution start is clamped to >= root start when exec derived start < root start", () => {
    const tracer = new RecordingTracer();
    // rootStart = T0+90, rootEnd = T0+190
    // execution: createdAtMs = T0+100, durationMs = 80 -> derived execStart = T0+20 < rootStart T0+90
    // After fix: execStartMs should be clamped to T0+90
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu", requestedAtMs: T0 + 90, durationMs: 100 },
        executions: [{ createdAtMs: T0 + 100, durationMs: 80, toolCalls: [] }],
      },
      tracer,
    );
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect(exec.startTimeMs).toBe(T0 + 90);
  });
});
