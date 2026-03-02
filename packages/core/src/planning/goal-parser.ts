import { randomUUID } from "node:crypto";
import type { GoalBrief, GoalType } from "@switchboard/schemas";

/**
 * GoalParser — converts natural language objectives into structured GoalBriefs.
 *
 * Strategy: deterministic regex patterns first, LLM-assisted second.
 * Returns null if the text cannot be classified as a goal.
 */
export class GoalParser {
  private patterns: Array<{
    regex: RegExp;
    type: GoalType;
    extractObjective: (match: RegExpMatchArray, text: string) => string;
    extractConstraints: (match: RegExpMatchArray) => GoalBrief["constraints"];
    extractMetrics: (match: RegExpMatchArray) => GoalBrief["successMetrics"];
    decomposable: boolean;
  }>;

  constructor() {
    this.patterns = [
      // Optimize patterns
      {
        regex: /(?:get|want|need)\s+more\s+(.+?)(?:\s+while|\s+keeping|\s+with|$)/i,
        type: "optimize",
        extractObjective: (m) => `Increase ${m[1]?.trim()}`,
        extractConstraints: (m) => {
          const constraintMatch = m.input?.match(
            /(?:keeping|under|below|less\s+than)\s+(?:\$)?(\d+(?:\.\d+)?)/i,
          );
          if (constraintMatch) {
            return [{
              field: "cpl",
              operator: "lte" as const,
              value: parseFloat(constraintMatch[1]!),
              unit: "USD",
            }];
          }
          return [];
        },
        extractMetrics: (m) => [{
          name: m[1]?.trim().toLowerCase().replace(/s$/, "") ?? "leads",
          direction: "increase" as const,
        }],
        decomposable: true,
      },
      {
        regex: /(?:maximize|improve|boost|increase)\s+(.+?)(?:\s+while|\s+keeping|$)/i,
        type: "optimize",
        extractObjective: (m) => `Maximize ${m[1]?.trim()}`,
        extractConstraints: () => [],
        extractMetrics: (m) => [{
          name: m[1]?.trim().toLowerCase() ?? "performance",
          direction: "increase" as const,
        }],
        decomposable: true,
      },
      // Investigate patterns
      {
        regex: /(?:why\s+is|why\s+are|what'?s?\s+wrong\s+with|what\s+happened\s+(?:to|with))\s+(.+)/i,
        type: "investigate",
        extractObjective: (m) => `Investigate: ${m[1]?.trim()}`,
        extractConstraints: () => [],
        extractMetrics: () => [],
        decomposable: true,
      },
      {
        regex: /(?:diagnose|debug|troubleshoot|analyze)\s+(.+)/i,
        type: "investigate",
        extractObjective: (m) => `Diagnose: ${m[1]?.trim()}`,
        extractConstraints: () => [],
        extractMetrics: () => [],
        decomposable: true,
      },
      // Execute patterns
      {
        regex: /^(?:pause|stop|halt)\s+(.+)/i,
        type: "execute",
        extractObjective: (m) => `Pause ${m[1]?.trim()}`,
        extractConstraints: () => [],
        extractMetrics: () => [],
        decomposable: false,
      },
      {
        regex: /^(?:resume|start|unpause|restart|enable)\s+(.+)/i,
        type: "execute",
        extractObjective: (m) => `Resume ${m[1]?.trim()}`,
        extractConstraints: () => [],
        extractMetrics: () => [],
        decomposable: false,
      },
      {
        regex: /(?:set|change|adjust)\s+(?:the\s+)?budget\s+(?:for\s+)?(.+?)\s+(?:to\s+)?\$?(\d+(?:\.\d+)?)/i,
        type: "execute",
        extractObjective: (m) => `Set budget for ${m[1]?.trim()} to $${m[2]}`,
        extractConstraints: () => [],
        extractMetrics: () => [],
        decomposable: false,
      },
      // Report patterns
      {
        regex: /(?:how\s+(?:are|is)|show\s+me|report\s+on|what'?s?\s+the\s+status\s+of)\s+(.+)/i,
        type: "report",
        extractObjective: (m) => `Report on ${m[1]?.trim()}`,
        extractConstraints: () => [],
        extractMetrics: () => [],
        decomposable: true,
      },
      {
        regex: /(?:performance|weekly|daily|monthly)\s+(?:report|summary|review)/i,
        type: "report",
        extractObjective: (_m, text) => `Generate report: ${text}`,
        extractConstraints: () => [],
        extractMetrics: () => [],
        decomposable: true,
      },
      // Maintain patterns
      {
        regex: /(?:keep|maintain|ensure)\s+(.+?)\s+(?:under|below|above|at)\s+(?:\$)?(\d+(?:\.\d+)?)/i,
        type: "maintain",
        extractObjective: (m) => `Maintain ${m[1]?.trim()} target $${m[2]}`,
        extractConstraints: (m) => [{
          field: m[1]?.trim().toLowerCase().replace(/\s+/g, "_") ?? "metric",
          operator: "lte" as const,
          value: parseFloat(m[2]!),
          unit: "USD",
        }],
        extractMetrics: (m) => [{
          name: m[1]?.trim().toLowerCase() ?? "metric",
          direction: "maintain" as const,
          targetValue: parseFloat(m[2]!),
        }],
        decomposable: true,
      },
    ];
  }

  /**
   * Parse natural language text into a GoalBrief.
   * Returns null if no goal pattern matches.
   */
  parse(text: string): GoalBrief | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    for (const pattern of this.patterns) {
      const match = trimmed.match(pattern.regex);
      if (match) {
        return {
          id: `goal_${randomUUID()}`,
          type: pattern.type,
          objective: pattern.extractObjective(match, trimmed),
          constraints: pattern.extractConstraints(match),
          successMetrics: pattern.extractMetrics(match),
          decomposable: pattern.decomposable,
        };
      }
    }

    return null;
  }
}
