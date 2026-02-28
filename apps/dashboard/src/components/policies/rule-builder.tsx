"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

interface PolicyCondition {
  field: string;
  operator: string;
  value: unknown;
}

interface PolicyRule {
  composition?: "AND" | "OR" | "NOT";
  conditions?: PolicyCondition[];
  children?: PolicyRule[];
}

const FIELD_SUGGESTIONS = [
  "actionType",
  "cartridgeId",
  "principalId",
  "riskCategory",
  "parameters.amount",
  "parameters.currency",
];

const OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "gt", label: ">" },
  { value: "gte", label: "\u2265" },
  { value: "lt", label: "<" },
  { value: "lte", label: "\u2264" },
  { value: "in", label: "in list" },
  { value: "not_in", label: "not in list" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "matches", label: "matches regex" },
  { value: "exists", label: "exists" },
  { value: "not_exists", label: "not exists" },
];

const VALUE_HIDDEN_OPERATORS = ["exists", "not_exists"];

interface RuleBuilderProps {
  value: PolicyRule;
  onChange: (rule: PolicyRule) => void;
}

export function RuleBuilder({ value, onChange }: RuleBuilderProps) {
  return <RuleGroupNode rule={value} onChange={onChange} depth={0} />;
}

interface RuleGroupNodeProps {
  rule: PolicyRule;
  onChange: (rule: PolicyRule) => void;
  onRemove?: () => void;
  depth: number;
}

function RuleGroupNode({ rule, onChange, onRemove, depth }: RuleGroupNodeProps) {
  const composition = rule.composition ?? "AND";
  const conditions = rule.conditions ?? [];
  const children = rule.children ?? [];

  const updateComposition = (comp: "AND" | "OR" | "NOT") => {
    onChange({ ...rule, composition: comp });
  };

  const updateCondition = (index: number, condition: PolicyCondition) => {
    const next = [...conditions];
    next[index] = condition;
    onChange({ ...rule, conditions: next });
  };

  const removeCondition = (index: number) => {
    const next = conditions.filter((_, i) => i !== index);
    onChange({ ...rule, conditions: next });
  };

  const addCondition = () => {
    onChange({
      ...rule,
      conditions: [...conditions, { field: "", operator: "eq", value: "" }],
    });
  };

  const updateChild = (index: number, child: PolicyRule) => {
    const next = [...children];
    next[index] = child;
    onChange({ ...rule, children: next });
  };

  const removeChild = (index: number) => {
    const next = children.filter((_, i) => i !== index);
    onChange({ ...rule, children: next });
  };

  const addGroup = () => {
    onChange({
      ...rule,
      children: [
        ...children,
        { composition: "AND", conditions: [{ field: "", operator: "eq", value: "" }] },
      ],
    });
  };

  return (
    <div
      className={
        depth > 0
          ? "border-l-2 border-primary/30 ml-4 pl-4 py-2 space-y-3"
          : "space-y-3"
      }
    >
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">When</span>
        <Select value={composition} onValueChange={(v) => updateComposition(v as "AND" | "OR" | "NOT")}>
          <SelectTrigger className="w-24 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">ALL</SelectItem>
            <SelectItem value="OR">ANY</SelectItem>
            <SelectItem value="NOT">NOT</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">of these match:</span>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="ml-auto h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {conditions.map((condition, i) => (
        <ConditionRow
          key={i}
          condition={condition}
          onChange={(c) => updateCondition(i, c)}
          onRemove={() => removeCondition(i)}
        />
      ))}

      {children.map((child, i) => (
        <RuleGroupNode
          key={i}
          rule={child}
          onChange={(c) => updateChild(i, c)}
          onRemove={() => removeChild(i)}
          depth={depth + 1}
        />
      ))}

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addCondition} className="h-7 text-xs">
          <Plus className="h-3 w-3 mr-1" />
          Add condition
        </Button>
        {depth < 3 && (
          <Button type="button" variant="outline" size="sm" onClick={addGroup} className="h-7 text-xs">
            <Plus className="h-3 w-3 mr-1" />
            Add group
          </Button>
        )}
      </div>
    </div>
  );
}

interface ConditionRowProps {
  condition: PolicyCondition;
  onChange: (condition: PolicyCondition) => void;
  onRemove: () => void;
}

function ConditionRow({ condition, onChange, onRemove }: ConditionRowProps) {
  const hideValue = VALUE_HIDDEN_OPERATORS.includes(condition.operator);
  const isListOperator = condition.operator === "in" || condition.operator === "not_in";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select
        value={FIELD_SUGGESTIONS.includes(condition.field) ? condition.field : "__custom__"}
        onValueChange={(v) => {
          if (v === "__custom__") return;
          onChange({ ...condition, field: v });
        }}
      >
        <SelectTrigger className="w-40 h-8 text-xs">
          <SelectValue placeholder="Field..." />
        </SelectTrigger>
        <SelectContent>
          {FIELD_SUGGESTIONS.map((f) => (
            <SelectItem key={f} value={f}>
              {f}
            </SelectItem>
          ))}
          <SelectItem value="__custom__">Custom...</SelectItem>
        </SelectContent>
      </Select>

      {(!FIELD_SUGGESTIONS.includes(condition.field) || condition.field === "") && (
        <Input
          className="w-36 h-8 text-xs"
          placeholder="field path"
          value={condition.field}
          onChange={(e) => onChange({ ...condition, field: e.target.value })}
        />
      )}

      <Select
        value={condition.operator}
        onValueChange={(v) => onChange({ ...condition, operator: v })}
      >
        <SelectTrigger className="w-32 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPERATORS.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {!hideValue && (
        <Input
          className="flex-1 min-w-[100px] h-8 text-xs"
          placeholder={isListOperator ? "val1, val2, ..." : "value"}
          value={String(condition.value ?? "")}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
        />
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
