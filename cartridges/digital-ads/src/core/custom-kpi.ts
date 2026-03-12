/* eslint-disable max-lines */
// ---------------------------------------------------------------------------
// Custom KPI Definitions & Engine
// ---------------------------------------------------------------------------
// Allows users to define parameterized custom metrics beyond the built-in
// ones (CPA, ROAS, CTR, etc.) with support for sum, average, weighted
// average, ratio, and custom expression types.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KPIAggregation = "sum" | "average" | "weighted_average" | "ratio" | "custom";

export interface CustomKPIDefinition {
  id: string;
  name: string;
  description: string;
  /** Formula type */
  type: KPIAggregation;
  /** For ratio type: numerator metric key */
  numerator?: string;
  /** For ratio type: denominator metric key */
  denominator?: string;
  /** For weighted_average: weight metric key */
  weightMetric?: string;
  /** For custom type: JavaScript-safe expression using metric keys as variables */
  expression?: string;
  /** For sum/average: list of metric keys to aggregate */
  metrics?: string[];
  /** Formatting */
  format: "number" | "currency" | "percentage" | "multiplier";
  /** Whether higher is better (for ranking/comparison) */
  higherIsBetter: boolean;
  /** Optional target value for threshold alerts */
  target?: number;
  /** Optional warning threshold (triggers warning when crossed) */
  warningThreshold?: number;
  /** Optional critical threshold */
  criticalThreshold?: number;
}

export interface KPIComputationResult {
  kpiId: string;
  kpiName: string;
  value: number;
  formattedValue: string;
  format: CustomKPIDefinition["format"];
  status: "on_target" | "warning" | "critical" | "no_target";
  target?: number;
  percentOfTarget?: number;
}

/** Available base metrics that can be used in KPI definitions */
export const BASE_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "revenue",
  "ctr",
  "cpc",
  "cpm",
  "cpa",
  "roas",
  "frequency",
  "reach",
  "video_views",
  "video_completions",
  "add_to_cart",
  "checkout_initiated",
  "purchases",
  "leads",
  "registrations",
  "page_views",
  "landing_page_views",
] as const;
export type BaseMetric = (typeof BASE_METRICS)[number];

// ---------------------------------------------------------------------------
// Safe Expression Evaluator — recursive descent parser
// ---------------------------------------------------------------------------
// Supports: +, -, *, /, parentheses, metric names (identifiers), numbers.
// Does NOT use eval().
// ---------------------------------------------------------------------------

/** Token types for the expression lexer */
type TokenType = "number" | "identifier" | "operator" | "lparen" | "rparen" | "eof";

interface Token {
  type: TokenType;
  value: string;
}

/**
 * Tokenizes an expression string into a list of tokens.
 * Recognizes numbers (int and decimal), identifiers (metric names with underscores),
 * arithmetic operators (+, -, *, /), and parentheses.
 */
function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i]!;

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // Numbers (integer or decimal)
    if (ch >= "0" && ch <= "9") {
      let num = "";
      while (
        i < expression.length &&
        ((expression[i]! >= "0" && expression[i]! <= "9") || expression[i] === ".")
      ) {
        num += expression[i]!;
        i++;
      }
      tokens.push({ type: "number", value: num });
      continue;
    }

    // Identifiers (metric names: letters, digits, underscores)
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      let ident = "";
      while (
        i < expression.length &&
        ((expression[i]! >= "a" && expression[i]! <= "z") ||
          (expression[i]! >= "A" && expression[i]! <= "Z") ||
          (expression[i]! >= "0" && expression[i]! <= "9") ||
          expression[i] === "_")
      ) {
        ident += expression[i]!;
        i++;
      }
      tokens.push({ type: "identifier", value: ident });
      continue;
    }

    // Operators
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "operator", value: ch });
      i++;
      continue;
    }

    // Parentheses
    if (ch === "(") {
      tokens.push({ type: "lparen", value: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ")" });
      i++;
      continue;
    }

    throw new Error(`Unexpected character in expression: '${ch}' at position ${i}`);
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

/**
 * Recursive descent parser and evaluator for arithmetic expressions.
 *
 * Grammar:
 *   expression = term (('+' | '-') term)*
 *   term       = factor (('*' | '/') factor)*
 *   factor     = NUMBER | IDENTIFIER | '(' expression ')' | ('+' | '-') factor
 */
class ExpressionEvaluator {
  private tokens: Token[];
  private pos: number;
  private metrics: Record<string, number>;

  constructor(tokens: Token[], metrics: Record<string, number>) {
    this.tokens = tokens;
    this.pos = 0;
    this.metrics = metrics;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private consume(): Token {
    const token = this.tokens[this.pos]!;
    this.pos++;
    return token;
  }

  evaluate(): number {
    const result = this.parseExpression();
    if (this.peek().type !== "eof") {
      throw new Error(`Unexpected token after end of expression: '${this.peek().value}'`);
    }
    return result;
  }

  private parseExpression(): number {
    let left = this.parseTerm();
    while (
      this.peek().type === "operator" &&
      (this.peek().value === "+" || this.peek().value === "-")
    ) {
      const op = this.consume().value;
      const right = this.parseTerm();
      if (op === "+") {
        left = left + right;
      } else {
        left = left - right;
      }
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parseFactor();
    while (
      this.peek().type === "operator" &&
      (this.peek().value === "*" || this.peek().value === "/")
    ) {
      const op = this.consume().value;
      const right = this.parseFactor();
      if (op === "*") {
        left = left * right;
      } else {
        if (right === 0) {
          return 0; // Safe division by zero: return 0
        }
        left = left / right;
      }
    }
    return left;
  }

  private parseFactor(): number {
    const token = this.peek();

    // Unary plus/minus
    if (token.type === "operator" && (token.value === "+" || token.value === "-")) {
      this.consume();
      const factor = this.parseFactor();
      return token.value === "-" ? -factor : factor;
    }

    // Number literal
    if (token.type === "number") {
      this.consume();
      const num = Number(token.value);
      if (isNaN(num)) {
        throw new Error(`Invalid number: ${token.value}`);
      }
      return num;
    }

    // Identifier (metric name)
    if (token.type === "identifier") {
      this.consume();
      const value = this.metrics[token.value];
      if (value === undefined) {
        throw new Error(`Unknown metric in expression: '${token.value}'`);
      }
      return value;
    }

    // Parenthesized sub-expression
    if (token.type === "lparen") {
      this.consume();
      const result = this.parseExpression();
      if (this.peek().type !== "rparen") {
        throw new Error("Missing closing parenthesis");
      }
      this.consume();
      return result;
    }

    throw new Error(`Unexpected token: '${token.value}' (type: ${token.type})`);
  }
}

/**
 * Safely evaluates an arithmetic expression with metric variables.
 * Does NOT use eval(). Uses a recursive descent parser.
 */
export function evaluateExpression(expression: string, metrics: Record<string, number>): number {
  const tokens = tokenize(expression);
  const evaluator = new ExpressionEvaluator(tokens, metrics);
  return evaluator.evaluate();
}

/**
 * Extracts all identifier names from an expression string.
 * Used during validation to check that all referenced metrics exist.
 */
export function extractMetricRefs(expression: string): string[] {
  const tokens = tokenize(expression);
  const identifiers: string[] = [];
  for (const token of tokens) {
    if (token.type === "identifier" && !identifiers.includes(token.value)) {
      identifiers.push(token.value);
    }
  }
  return identifiers;
}

// ---------------------------------------------------------------------------
// Custom KPI Engine
// ---------------------------------------------------------------------------

let nextId = 1;

function generateId(): string {
  return `kpi_${nextId++}`;
}

export class CustomKPIEngine {
  private registry = new Map<string, CustomKPIDefinition>();

  /**
   * Register a new custom KPI definition.
   * Auto-generates an ID and validates the definition.
   */
  registerKPI(definition: Omit<CustomKPIDefinition, "id">): CustomKPIDefinition {
    this.validateDefinition(definition);

    const id = generateId();
    const kpi: CustomKPIDefinition = { ...definition, id };
    this.registry.set(id, kpi);
    return kpi;
  }

  /**
   * Compute a single KPI value from a metrics map.
   */
  computeKPI(kpiId: string, metrics: Record<string, number>): KPIComputationResult {
    const kpi = this.registry.get(kpiId);
    if (!kpi) {
      throw new Error(`KPI not found: ${kpiId}`);
    }
    return this.compute(kpi, metrics);
  }

  /**
   * Compute all registered KPIs against the provided metrics map.
   */
  computeAllKPIs(metrics: Record<string, number>): KPIComputationResult[] {
    const results: KPIComputationResult[] = [];
    for (const kpi of this.registry.values()) {
      results.push(this.compute(kpi, metrics));
    }
    return results;
  }

  /**
   * List all registered KPI definitions.
   */
  listKPIs(): CustomKPIDefinition[] {
    return Array.from(this.registry.values());
  }

  /**
   * Remove a KPI definition by ID.
   * Returns true if the KPI was found and removed, false otherwise.
   */
  removeKPI(kpiId: string): boolean {
    return this.registry.delete(kpiId);
  }

  /**
   * Returns a set of useful pre-built KPI definitions that users commonly want.
   * These are not automatically registered; call registerKPI() on each to use them.
   */
  getPresetKPIs(): CustomKPIDefinition[] {
    return [
      {
        id: "preset_blended_cpa",
        name: "Blended CPA",
        description: "Cost per acquisition across all conversions (spend / conversions)",
        type: "ratio",
        numerator: "spend",
        denominator: "conversions",
        format: "currency",
        higherIsBetter: false,
      },
      {
        id: "preset_roas",
        name: "ROAS",
        description: "Return on ad spend (revenue / spend)",
        type: "ratio",
        numerator: "revenue",
        denominator: "spend",
        format: "multiplier",
        higherIsBetter: true,
      },
      {
        id: "preset_cost_per_lpv",
        name: "Cost per Landing Page View",
        description: "Cost efficiency for driving landing page views (spend / landing_page_views)",
        type: "ratio",
        numerator: "spend",
        denominator: "landing_page_views",
        format: "currency",
        higherIsBetter: false,
      },
      {
        id: "preset_click_to_conversion",
        name: "Click-to-Conversion Rate",
        description: "Percentage of clicks that result in a conversion (conversions / clicks)",
        type: "ratio",
        numerator: "conversions",
        denominator: "clicks",
        format: "percentage",
        higherIsBetter: true,
      },
      {
        id: "preset_revenue_per_click",
        name: "Revenue per Click",
        description: "Average revenue generated per click (revenue / clicks)",
        type: "ratio",
        numerator: "revenue",
        denominator: "clicks",
        format: "currency",
        higherIsBetter: true,
      },
      {
        id: "preset_cpm_efficiency",
        name: "CPM Efficiency",
        description: "Conversions per thousand impressions (conversions / impressions * 1000)",
        type: "custom",
        expression: "conversions / impressions * 1000",
        format: "number",
        higherIsBetter: true,
      },
      {
        id: "preset_engagement_rate",
        name: "Engagement Rate",
        description:
          "Combined click and video view engagement rate ((clicks + video_views) / impressions)",
        type: "custom",
        expression: "(clicks + video_views) / impressions",
        format: "percentage",
        higherIsBetter: true,
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private validateDefinition(definition: Omit<CustomKPIDefinition, "id">): void {
    if (!definition.name || definition.name.trim().length === 0) {
      throw new Error("KPI name is required");
    }
    if (!definition.description || definition.description.trim().length === 0) {
      throw new Error("KPI description is required");
    }

    const validTypes: KPIAggregation[] = ["sum", "average", "weighted_average", "ratio", "custom"];
    if (!validTypes.includes(definition.type)) {
      throw new Error(
        `Invalid KPI type: ${definition.type}. Must be one of: ${validTypes.join(", ")}`,
      );
    }

    const validFormats = ["number", "currency", "percentage", "multiplier"];
    if (!validFormats.includes(definition.format)) {
      throw new Error(
        `Invalid format: ${definition.format}. Must be one of: ${validFormats.join(", ")}`,
      );
    }

    switch (definition.type) {
      case "ratio":
        if (!definition.numerator) {
          throw new Error("Ratio KPI requires a numerator metric");
        }
        if (!definition.denominator) {
          throw new Error("Ratio KPI requires a denominator metric");
        }
        this.validateMetricRef(definition.numerator);
        this.validateMetricRef(definition.denominator);
        break;

      case "sum":
      case "average":
        if (!definition.metrics || definition.metrics.length === 0) {
          throw new Error(
            `${definition.type} KPI requires a metrics array with at least one metric`,
          );
        }
        for (const m of definition.metrics) {
          this.validateMetricRef(m);
        }
        break;

      case "weighted_average":
        if (!definition.metrics || definition.metrics.length === 0) {
          throw new Error("weighted_average KPI requires a metrics array with at least one metric");
        }
        if (!definition.weightMetric) {
          throw new Error("weighted_average KPI requires a weightMetric");
        }
        for (const m of definition.metrics) {
          this.validateMetricRef(m);
        }
        this.validateMetricRef(definition.weightMetric);
        break;

      case "custom":
        if (!definition.expression || definition.expression.trim().length === 0) {
          throw new Error("Custom KPI requires an expression");
        }
        // Validate expression by extracting identifiers and checking them
        try {
          const refs = extractMetricRefs(definition.expression);
          for (const ref of refs) {
            this.validateMetricRef(ref);
          }
        } catch (err) {
          throw new Error(
            `Invalid expression: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
    }

    // Validate threshold ordering
    if (definition.warningThreshold !== undefined && definition.criticalThreshold !== undefined) {
      if (definition.higherIsBetter) {
        if (definition.warningThreshold < definition.criticalThreshold) {
          throw new Error(
            "For higherIsBetter KPIs, warningThreshold should be >= criticalThreshold",
          );
        }
      } else {
        if (definition.warningThreshold > definition.criticalThreshold) {
          throw new Error(
            "For lowerIsBetter KPIs, warningThreshold should be <= criticalThreshold",
          );
        }
      }
    }
  }

  private validateMetricRef(metric: string): void {
    const allValid = BASE_METRICS as readonly string[];
    if (!allValid.includes(metric)) {
      throw new Error(`Unknown metric '${metric}'. Valid metrics: ${BASE_METRICS.join(", ")}`);
    }
  }

  private compute(kpi: CustomKPIDefinition, metrics: Record<string, number>): KPIComputationResult {
    let value: number;

    switch (kpi.type) {
      case "sum": {
        value = 0;
        for (const m of kpi.metrics ?? []) {
          value += metrics[m] ?? 0;
        }
        break;
      }

      case "average": {
        const metricList = kpi.metrics ?? [];
        if (metricList.length === 0) {
          value = 0;
          break;
        }
        let sum = 0;
        for (const m of metricList) {
          sum += metrics[m] ?? 0;
        }
        value = sum / metricList.length;
        break;
      }

      case "weighted_average": {
        const metricList = kpi.metrics ?? [];
        const weightKey = kpi.weightMetric ?? "";
        const totalWeight = metrics[weightKey] ?? 0;
        if (totalWeight === 0 || metricList.length === 0) {
          value = 0;
          break;
        }
        let weightedSum = 0;
        for (const m of metricList) {
          weightedSum += (metrics[m] ?? 0) * totalWeight;
        }
        value = weightedSum / (totalWeight * metricList.length);
        break;
      }

      case "ratio": {
        const num = metrics[kpi.numerator ?? ""] ?? 0;
        const den = metrics[kpi.denominator ?? ""] ?? 0;
        value = den !== 0 ? num / den : 0;
        break;
      }

      case "custom": {
        try {
          value = evaluateExpression(kpi.expression ?? "", metrics);
        } catch {
          value = 0;
        }
        break;
      }

      default:
        value = 0;
    }

    // Handle NaN / Infinity
    if (!isFinite(value)) {
      value = 0;
    }

    const formattedValue = this.formatValue(value, kpi.format);
    const status = this.evaluateStatus(value, kpi);
    const percentOfTarget =
      kpi.target !== undefined && kpi.target !== 0 ? (value / kpi.target) * 100 : undefined;

    return {
      kpiId: kpi.id,
      kpiName: kpi.name,
      value,
      formattedValue,
      format: kpi.format,
      status,
      target: kpi.target,
      percentOfTarget,
    };
  }

  private formatValue(value: number, format: CustomKPIDefinition["format"]): string {
    switch (format) {
      case "currency":
        return `$${value.toFixed(2)}`;
      case "percentage":
        return `${(value * 100).toFixed(2)}%`;
      case "multiplier":
        return `${value.toFixed(2)}x`;
      case "number":
      default:
        return value.toFixed(2);
    }
  }

  private evaluateStatus(value: number, kpi: CustomKPIDefinition): KPIComputationResult["status"] {
    if (kpi.target === undefined) {
      return "no_target";
    }

    // Check critical threshold first
    if (kpi.criticalThreshold !== undefined) {
      if (kpi.higherIsBetter && value <= kpi.criticalThreshold) {
        return "critical";
      }
      if (!kpi.higherIsBetter && value >= kpi.criticalThreshold) {
        return "critical";
      }
    }

    // Check warning threshold
    if (kpi.warningThreshold !== undefined) {
      if (kpi.higherIsBetter && value <= kpi.warningThreshold) {
        return "warning";
      }
      if (!kpi.higherIsBetter && value >= kpi.warningThreshold) {
        return "warning";
      }
    }

    return "on_target";
  }
}
