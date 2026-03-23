# Unified Onboarding Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace both `/setup` and `/setup/agents` wizards with a single unified onboarding flow that persists business config, activates agents with per-agent tone, uploads knowledge + behavioral rules, and provisions messaging channels.

**Architecture:** A 6-step wizard in the Next.js dashboard using the existing `WizardShell` component. New step components for agent config, knowledge/rules, and channel setup. A single `handleComplete` calls existing backend APIs: `/api/agents/wizard-complete`, `/api/knowledge/upload`, `/api/organizations/:orgId/provision`. No new backend routes needed — all API endpoints already exist.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui components, existing Fastify API routes

---

## Context for Implementers

### Existing Code You Need to Know

| File                                                                    | What It Does                                                                                        | Relevance                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/dashboard/src/components/onboarding/wizard-shell.tsx`             | Step wizard container with progress bar, back/next buttons                                          | **Reuse as-is** — this is the shell for all steps             |
| `apps/dashboard/src/components/onboarding/step-business-basics.tsx`     | Vertical picker + business name/services/target/pricing inputs                                      | **Reuse with modifications** — good base for Step 0           |
| `apps/dashboard/src/components/onboarding/step-agent-selection.tsx`     | Agent toggle cards with icons                                                                       | **Reuse as-is** for Step 1                                    |
| `apps/dashboard/src/components/onboarding/step-tone-language.tsx`       | Tone picker + language selector                                                                     | **Reference for patterns** — we'll build per-agent tone cards |
| `apps/dashboard/src/app/setup/agents/page.tsx`                          | Current 4-step wizard page                                                                          | **Replace** with new unified wizard                           |
| `apps/dashboard/src/app/setup/page.tsx`                                 | Current 8-step ads wizard page                                                                      | **Replace** with redirect to new wizard                       |
| `apps/api/src/routes/agents.ts:280-345`                                 | `POST /api/agents/wizard-complete` — persists org config + activates agents                         | **Existing backend** — called at wizard completion            |
| `apps/api/src/routes/knowledge.ts:51-122`                               | `POST /api/knowledge/upload` — stores knowledge chunks                                              | **Existing backend** — called for knowledge + rules           |
| `apps/api/src/routes/org-channels.ts:30-253`                            | `POST /api/organizations/:orgId/provision` — creates Connection, ManagedChannel, registers webhooks | **Existing backend** — called for channel provisioning        |
| `packages/agents/src/agents/lead-responder/tone-presets.ts`             | `TONE_PRESETS` — 3 tone options with system prompt strings                                          | **Reference** — tone IDs match wizard choices                 |
| `apps/dashboard/src/lib/api-client-base.ts:224-248`                     | `provision()` client method                                                                         | **Existing client** — use for channel provisioning            |
| `apps/dashboard/src/app/api/dashboard/agents/wizard-complete/route.ts`  | Dashboard proxy route to API                                                                        | **Existing proxy**                                            |
| `apps/dashboard/src/app/api/dashboard/knowledge/upload/route.ts`        | Dashboard proxy route for knowledge upload                                                          | **Existing proxy**                                            |
| `apps/dashboard/src/app/api/dashboard/organizations/provision/route.ts` | Dashboard proxy route for channel provisioning                                                      | **Existing proxy**                                            |

### Dashboard Conventions

- **No `.js` extensions** in imports (uses `moduleResolution: "bundler"`)
- Components use **shadcn/ui** (`Card`, `CardContent`, `Button`, `Input`, `Label`, `Textarea` from `@/components/ui/`)
- Styling: **Tailwind CSS** with design tokens (`text-foreground`, `bg-surface`, `border-primary`, etc.)
- State: **React `useState`** (no external state management)
- API calls: **`fetch` to `/api/dashboard/...` proxy routes** (these forward to the Fastify API with auth)
- Toast notifications: **`useToast()` from `@/components/ui/use-toast`**

### Tone IDs (must match backend)

The 3 tone preset IDs used throughout the agent system:

- `warm-professional` — "Warm & Professional"
- `casual-conversational` — "Casual & Conversational"
- `direct-efficient` — "Direct & Efficient"

### Agent IDs (must match backend)

- `lead-responder` — Lead Responder
- `sales-closer` — Sales Closer
- `nurture` — Nurture
- `revenue-tracker` — Revenue Tracker
- `ad-optimizer` — Ad Optimizer

---

## File Structure

### New Files

| File                                                                               | Responsibility                                                               |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/dashboard/src/app/onboarding/page.tsx`                                       | Unified wizard page — state management, step orchestration, `handleComplete` |
| `apps/dashboard/src/components/onboarding/step-agent-style.tsx`                    | Per-agent tone config with live preview cards                                |
| `apps/dashboard/src/components/onboarding/step-knowledge-rules.tsx`                | Knowledge upload textarea + behavioral rule templates + free-text rules      |
| `apps/dashboard/src/components/onboarding/step-channels.tsx`                       | Founder channel (Telegram/WhatsApp) + customer channel (WhatsApp) setup      |
| `apps/dashboard/src/components/onboarding/step-review-launch.tsx`                  | Team summary review + launch button with celebration                         |
| `apps/dashboard/src/components/onboarding/__tests__/step-agent-style.test.tsx`     | Tests for agent style step                                                   |
| `apps/dashboard/src/components/onboarding/__tests__/step-knowledge-rules.test.tsx` | Tests for knowledge/rules step                                               |
| `apps/dashboard/src/components/onboarding/__tests__/step-channels.test.tsx`        | Tests for channel step                                                       |
| `apps/dashboard/src/components/onboarding/__tests__/step-review-launch.test.tsx`   | Tests for review/launch step                                                 |

### Modified Files

| File                                           | Change                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/dashboard/src/app/setup/page.tsx`        | Replace with redirect to `/onboarding`                                       |
| `apps/dashboard/src/app/setup/agents/page.tsx` | Replace with redirect to `/onboarding`                                       |
| `apps/api/src/routes/agents.ts`                | Add `agentTones` field to wizard-complete body (Record<agentId, tonePreset>) |

### Unchanged (Reused As-Is)

- `wizard-shell.tsx` — step container
- `step-business-basics.tsx` — business info step (Step 0)
- `step-agent-selection.tsx` — agent picker (Step 1)
- All backend API routes (knowledge upload, channel provisioning)
- All dashboard proxy routes

---

## Tasks

### Task 1: Create the unified wizard page shell

**Files:**

- Create: `apps/dashboard/src/app/onboarding/page.tsx`

This is the main orchestrator. It holds all wizard state and renders each step.

- [ ] **Step 1: Create the page with all state variables and step rendering**

```tsx
// apps/dashboard/src/app/onboarding/page.tsx
"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import { StepBusinessBasics } from "@/components/onboarding/step-business-basics";
import { StepAgentSelection } from "@/components/onboarding/step-agent-selection";
import { StepAgentStyle } from "@/components/onboarding/step-agent-style";
import { StepKnowledgeRules } from "@/components/onboarding/step-knowledge-rules";
import { StepChannels } from "@/components/onboarding/step-channels";
import { StepReviewLaunch } from "@/components/onboarding/step-review-launch";
import { useToast } from "@/components/ui/use-toast";

const STEP_LABELS = [
  "Your business",
  "Build your team",
  "Set their style",
  "Teach them",
  "Connect channels",
  "Meet your team",
];

export interface BehavioralRule {
  type: "max-discount" | "always-escalate" | "never-discuss" | "custom";
  value: string;
}

export interface ChannelConfig {
  founderChannel: "telegram" | "whatsapp" | null;
  founderTelegramToken: string;
  founderWhatsAppToken: string;
  founderWhatsAppPhoneNumberId: string;
  customerWhatsAppToken: string;
  customerWhatsAppPhoneNumberId: string;
}

export default function OnboardingPage() {
  const { status } = useSession();
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 0: Business basics
  const [vertical, setVertical] = useState("clinic");
  const [businessName, setBusinessName] = useState("");
  const [services, setServices] = useState("");
  const [targetCustomer, setTargetCustomer] = useState("");
  const [pricingRange, setPricingRange] = useState("");

  // Step 1: Agent selection
  const [selectedAgents, setSelectedAgents] = useState<string[]>([
    "lead-responder",
    "sales-closer",
  ]);

  // Step 2: Per-agent tone
  const [agentTones, setAgentTones] = useState<Record<string, string>>({});

  // Step 3: Knowledge + rules
  const [knowledgeText, setKnowledgeText] = useState("");
  const [rules, setRules] = useState<BehavioralRule[]>([]);

  // Step 4: Channels
  const [channels, setChannels] = useState<ChannelConfig>({
    founderChannel: null,
    founderTelegramToken: "",
    founderWhatsAppToken: "",
    founderWhatsAppPhoneNumberId: "",
    customerWhatsAppToken: "",
    customerWhatsAppPhoneNumberId: "",
  });

  // Step 5: Launch
  const [launchStatus, setLaunchStatus] = useState<"idle" | "launching" | "done">("idle");

  if (status === "loading") return null;
  if (status === "unauthenticated") redirect("/login");

  const canProceed = (() => {
    switch (step) {
      case 0:
        return businessName.trim() !== "" && services.trim() !== "";
      case 1:
        return selectedAgents.length > 0;
      case 2:
        return selectedAgents.every((id) => agentTones[id]);
      case 3:
        return true; // Knowledge and rules are optional
      case 4:
        return channels.founderChannel !== null;
      case 5:
        return true;
      default:
        return false;
    }
  })();

  const handleComplete = async () => {
    setIsSubmitting(true);
    setLaunchStatus("launching");
    try {
      // 1. Persist business config + activate agents
      await fetch("/api/dashboard/agents/wizard-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vertical,
          businessName,
          services: services
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          targetCustomer,
          pricingRange,
          purchasedAgents: selectedAgents,
          agentTones,
          tonePreset: agentTones[selectedAgents[0] ?? ""] ?? "warm-professional",
          language: "en",
        }),
      });

      // 2. Upload knowledge (if provided)
      if (knowledgeText.trim()) {
        await fetch("/api/dashboard/knowledge/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: knowledgeText,
            fileName: "onboarding-knowledge",
            agentId: "global",
            sourceType: "wizard",
          }),
        });
      }

      // 3. Upload behavioral rules as knowledge chunks
      const ruleTexts = rules
        .filter((r) => r.value.trim())
        .map((r) => {
          switch (r.type) {
            case "max-discount":
              return `RULE: Never offer a discount greater than ${r.value}%. If a customer asks for a larger discount, politely decline and offer the maximum of ${r.value}% instead.`;
            case "always-escalate":
              return `RULE: Always escalate to the business owner when: ${r.value}. Do not attempt to handle this yourself.`;
            case "never-discuss":
              return `RULE: Never discuss or provide information about: ${r.value}. If asked, politely redirect the conversation.`;
            case "custom":
              return `RULE: ${r.value}`;
          }
        });

      if (ruleTexts.length > 0) {
        await fetch("/api/dashboard/knowledge/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: ruleTexts.join("\n\n"),
            fileName: "behavioral-rules",
            agentId: "global",
            sourceType: "wizard",
          }),
        });
      }

      // 4. Provision channels
      const channelsToProvision: Array<Record<string, string | undefined>> = [];

      if (channels.founderChannel === "telegram" && channels.founderTelegramToken) {
        channelsToProvision.push({
          channel: "telegram",
          botToken: channels.founderTelegramToken,
        });
      }

      if (channels.founderChannel === "whatsapp" && channels.founderWhatsAppToken) {
        channelsToProvision.push({
          channel: "whatsapp",
          token: channels.founderWhatsAppToken,
          phoneNumberId: channels.founderWhatsAppPhoneNumberId,
        });
      }

      // Customer WhatsApp (separate from founder channel)
      if (channels.customerWhatsAppToken && channels.customerWhatsAppPhoneNumberId) {
        // Only add if not already covered by founder WhatsApp
        if (channels.founderChannel !== "whatsapp") {
          channelsToProvision.push({
            channel: "whatsapp",
            token: channels.customerWhatsAppToken,
            phoneNumberId: channels.customerWhatsAppPhoneNumberId,
          });
        }
      }

      if (channelsToProvision.length > 0) {
        await fetch("/api/dashboard/organizations/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channels: channelsToProvision }),
        });
      }

      setLaunchStatus("done");
      toast({
        title: "Your team is ready!",
        description: "Redirecting to your dashboard...",
      });

      setTimeout(() => router.push("/"), 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Setup failed", description: message, variant: "destructive" });
      setLaunchStatus("idle");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <WizardShell
      step={step}
      stepLabels={STEP_LABELS}
      onNext={() => setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1))}
      onBack={() => setStep((s) => Math.max(s - 1, 0))}
      canProceed={canProceed}
      isSubmitting={isSubmitting}
      isLastStep={step === STEP_LABELS.length - 1}
      onComplete={handleComplete}
    >
      {step === 0 && (
        <StepBusinessBasics
          vertical={vertical}
          onVerticalChange={setVertical}
          businessName={businessName}
          onNameChange={setBusinessName}
          services={services}
          onServicesChange={setServices}
          targetCustomer={targetCustomer}
          onTargetCustomerChange={setTargetCustomer}
          pricingRange={pricingRange}
          onPricingRangeChange={setPricingRange}
        />
      )}
      {step === 1 && (
        <StepAgentSelection selected={selectedAgents} onSelectionChange={setSelectedAgents} />
      )}
      {step === 2 && (
        <StepAgentStyle
          selectedAgents={selectedAgents}
          agentTones={agentTones}
          onTonesChange={setAgentTones}
          businessName={businessName}
        />
      )}
      {step === 3 && (
        <StepKnowledgeRules
          knowledgeText={knowledgeText}
          onKnowledgeChange={setKnowledgeText}
          rules={rules}
          onRulesChange={setRules}
        />
      )}
      {step === 4 && <StepChannels channels={channels} onChannelsChange={setChannels} />}
      {step === 5 && (
        <StepReviewLaunch
          businessName={businessName}
          selectedAgents={selectedAgents}
          agentTones={agentTones}
          channels={channels}
          launchStatus={launchStatus}
        />
      )}
    </WizardShell>
  );
}
```

- [ ] **Step 2: Verify the page renders**

Run: `pnpm --filter @switchboard/dashboard dev`
Navigate to `http://localhost:3002/onboarding`
Expected: Page renders with Step 0 (business basics) — will show errors for missing step components, which we'll create next.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(dashboard): add unified onboarding wizard page shell"
```

---

### Task 2: Create the per-agent style step (Step 2)

**Files:**

- Create: `apps/dashboard/src/components/onboarding/step-agent-style.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/step-agent-style.test.tsx`

This step shows a card for each selected agent. Each card has: the agent's name and one-liner, a tone picker (3 options), and a live preview of how the agent would greet a customer in the chosen tone.

- [ ] **Step 1: Write the test**

```tsx
// apps/dashboard/src/components/onboarding/__tests__/step-agent-style.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepAgentStyle } from "../step-agent-style";

describe("StepAgentStyle", () => {
  const defaultProps = {
    selectedAgents: ["lead-responder", "sales-closer"],
    agentTones: {} as Record<string, string>,
    onTonesChange: vi.fn(),
    businessName: "Radiance Spa",
  };

  it("renders a card for each selected agent", () => {
    render(<StepAgentStyle {...defaultProps} />);
    expect(screen.getByText("Lead Responder")).toBeTruthy();
    expect(screen.getByText("Sales Closer")).toBeTruthy();
  });

  it("shows tone options for each agent", () => {
    render(<StepAgentStyle {...defaultProps} />);
    // Each agent card should have 3 tone buttons
    const warmButtons = screen.getAllByText("Warm");
    expect(warmButtons.length).toBe(2);
  });

  it("calls onTonesChange when a tone is selected", () => {
    const onTonesChange = vi.fn();
    render(<StepAgentStyle {...defaultProps} onTonesChange={onTonesChange} />);
    const warmButtons = screen.getAllByText("Warm");
    fireEvent.click(warmButtons[0]!);
    expect(onTonesChange).toHaveBeenCalledWith({ "lead-responder": "warm-professional" });
  });

  it("shows a live preview when tone is selected", () => {
    render(
      <StepAgentStyle {...defaultProps} agentTones={{ "lead-responder": "warm-professional" }} />,
    );
    // Preview should contain the business name
    expect(screen.getByText(/Radiance Spa/)).toBeTruthy();
  });

  it("does not render agents that are not selected", () => {
    render(<StepAgentStyle {...defaultProps} selectedAgents={["lead-responder"]} />);
    expect(screen.queryByText("Sales Closer")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- step-agent-style`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

```tsx
// apps/dashboard/src/components/onboarding/step-agent-style.tsx
"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MessageSquare, Target, BellRing, TrendingUp, Zap } from "lucide-react";

interface StepAgentStyleProps {
  selectedAgents: string[];
  agentTones: Record<string, string>;
  onTonesChange: (tones: Record<string, string>) => void;
  businessName: string;
}

const AGENT_META: Record<
  string,
  { label: string; description: string; icon: typeof MessageSquare }
> = {
  "lead-responder": {
    label: "Lead Responder",
    description: "First point of contact for new leads",
    icon: MessageSquare,
  },
  "sales-closer": {
    label: "Sales Closer",
    description: "Converts qualified leads into bookings",
    icon: Target,
  },
  nurture: {
    label: "Nurture",
    description: "Follow-ups, reminders, and winbacks",
    icon: BellRing,
  },
  "revenue-tracker": {
    label: "Revenue Tracker",
    description: "Attributes revenue to ad campaigns",
    icon: TrendingUp,
  },
  "ad-optimizer": {
    label: "Ad Optimizer",
    description: "Adjusts ad spend based on performance",
    icon: Zap,
  },
};

const TONES = [
  { id: "warm-professional", short: "Warm", label: "Warm & Professional" },
  { id: "casual-conversational", short: "Casual", label: "Casual & Conversational" },
  { id: "direct-efficient", short: "Direct", label: "Direct & Efficient" },
];

function getPreviewGreeting(toneId: string, businessName: string): string {
  const name = businessName || "your business";
  switch (toneId) {
    case "warm-professional":
      return `"Hi there! Welcome to ${name}. I'd love to help you find the perfect service. What are you looking for today?"`;
    case "casual-conversational":
      return `"Hey! Thanks for reaching out to ${name}. What can I help you with?"`;
    case "direct-efficient":
      return `"Hello. How can I assist you with ${name}'s services today?"`;
    default:
      return "";
  }
}

export function StepAgentStyle({
  selectedAgents,
  agentTones,
  onTonesChange,
  businessName,
}: StepAgentStyleProps) {
  const setTone = (agentId: string, toneId: string) => {
    onTonesChange({ ...agentTones, [agentId]: toneId });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-base">How should each agent sound?</Label>
        <p className="text-[13px] text-muted-foreground">
          Pick a tone for each team member. You'll see a preview of how they'll greet customers.
        </p>
      </div>

      <div className="space-y-3">
        {selectedAgents.map((agentId) => {
          const meta = AGENT_META[agentId];
          if (!meta) return null;
          const Icon = meta.icon;
          const selectedTone = agentTones[agentId];

          return (
            <Card key={agentId} className="overflow-hidden">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{meta.label}</p>
                    <p className="text-[12px] text-muted-foreground">{meta.description}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  {TONES.map((tone) => (
                    <button
                      key={tone.id}
                      onClick={() => setTone(agentId, tone.id)}
                      className={cn(
                        "flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border",
                        selectedTone === tone.id
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-transparent text-muted-foreground border-border hover:border-primary/30",
                      )}
                    >
                      {tone.short}
                    </button>
                  ))}
                </div>

                {selectedTone && (
                  <div className="rounded-md bg-muted/50 p-3 border border-border/50">
                    <p className="text-[12px] text-muted-foreground mb-1">Preview</p>
                    <p className="text-[13px] text-foreground italic">
                      {getPreviewGreeting(selectedTone, businessName)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- step-agent-style`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(dashboard): add per-agent style step with tone preview"
```

---

### Task 3: Create the knowledge & rules step (Step 3)

**Files:**

- Create: `apps/dashboard/src/components/onboarding/step-knowledge-rules.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/step-knowledge-rules.test.tsx`

Two sections: (a) a textarea for pasting business knowledge (FAQ, services, pricing), (b) structured behavioral rule templates + free-text.

- [ ] **Step 1: Write the test**

```tsx
// apps/dashboard/src/components/onboarding/__tests__/step-knowledge-rules.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepKnowledgeRules } from "../step-knowledge-rules";
import type { BehavioralRule } from "@/app/onboarding/page";

describe("StepKnowledgeRules", () => {
  const defaultProps = {
    knowledgeText: "",
    onKnowledgeChange: vi.fn(),
    rules: [] as BehavioralRule[],
    onRulesChange: vi.fn(),
  };

  it("renders knowledge textarea", () => {
    render(<StepKnowledgeRules {...defaultProps} />);
    expect(screen.getByPlaceholderText(/paste your FAQ/i)).toBeTruthy();
  });

  it("renders rule template buttons", () => {
    render(<StepKnowledgeRules {...defaultProps} />);
    expect(screen.getByText(/Max discount/i)).toBeTruthy();
    expect(screen.getByText(/Always escalate/i)).toBeTruthy();
    expect(screen.getByText(/Never discuss/i)).toBeTruthy();
    expect(screen.getByText(/Custom rule/i)).toBeTruthy();
  });

  it("adds a rule when template is clicked", () => {
    const onRulesChange = vi.fn();
    render(<StepKnowledgeRules {...defaultProps} onRulesChange={onRulesChange} />);
    fireEvent.click(screen.getByText(/Max discount/i));
    expect(onRulesChange).toHaveBeenCalledWith([{ type: "max-discount", value: "" }]);
  });

  it("shows added rules with input fields", () => {
    render(
      <StepKnowledgeRules {...defaultProps} rules={[{ type: "max-discount", value: "15" }]} />,
    );
    const input = screen.getByDisplayValue("15");
    expect(input).toBeTruthy();
  });

  it("removes a rule when delete is clicked", () => {
    const onRulesChange = vi.fn();
    render(
      <StepKnowledgeRules
        {...defaultProps}
        rules={[{ type: "max-discount", value: "15" }]}
        onRulesChange={onRulesChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove rule"));
    expect(onRulesChange).toHaveBeenCalledWith([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- step-knowledge-rules`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

```tsx
// apps/dashboard/src/components/onboarding/step-knowledge-rules.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, X, Percent, AlertTriangle, Ban, PenLine } from "lucide-react";
import type { BehavioralRule } from "@/app/onboarding/page";

interface StepKnowledgeRulesProps {
  knowledgeText: string;
  onKnowledgeChange: (text: string) => void;
  rules: BehavioralRule[];
  onRulesChange: (rules: BehavioralRule[]) => void;
}

const RULE_TEMPLATES: Array<{
  type: BehavioralRule["type"];
  label: string;
  placeholder: string;
  icon: typeof Percent;
}> = [
  {
    type: "max-discount",
    label: "Max discount",
    placeholder: "e.g. 15",
    icon: Percent,
  },
  {
    type: "always-escalate",
    label: "Always escalate",
    placeholder: "e.g. billing disputes, refund requests",
    icon: AlertTriangle,
  },
  {
    type: "never-discuss",
    label: "Never discuss",
    placeholder: "e.g. competitor pricing, internal operations",
    icon: Ban,
  },
  {
    type: "custom",
    label: "Custom rule",
    placeholder: "e.g. Always recommend our premium package first",
    icon: PenLine,
  },
];

export function StepKnowledgeRules({
  knowledgeText,
  onKnowledgeChange,
  rules,
  onRulesChange,
}: StepKnowledgeRulesProps) {
  const addRule = (type: BehavioralRule["type"]) => {
    onRulesChange([...rules, { type, value: "" }]);
  };

  const updateRule = (index: number, value: string) => {
    const updated = [...rules];
    updated[index] = { ...updated[index]!, value };
    onRulesChange(updated);
  };

  const removeRule = (index: number) => {
    onRulesChange(rules.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      {/* Knowledge section */}
      <div className="space-y-2">
        <Label className="text-base">What should your agents know?</Label>
        <p className="text-[13px] text-muted-foreground">
          Paste your FAQ, services list, pricing, or anything your agents should reference when
          talking to customers. You can always add more later.
        </p>
        <Textarea
          placeholder="Paste your FAQ, service descriptions, pricing info, business hours, or any other information your agents should know..."
          value={knowledgeText}
          onChange={(e) => onKnowledgeChange(e.target.value)}
          rows={6}
          className="resize-y text-sm"
        />
        {knowledgeText && (
          <p className="text-[11px] text-muted-foreground">
            {knowledgeText.split(/\s+/).filter(Boolean).length} words
          </p>
        )}
      </div>

      {/* Rules section */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-base">Ground rules</Label>
          <p className="text-[13px] text-muted-foreground">
            Set boundaries for how your agents behave. These are enforced across all conversations.
          </p>
        </div>

        {/* Added rules */}
        {rules.map((rule, index) => {
          const template = RULE_TEMPLATES.find((t) => t.type === rule.type);
          return (
            <div key={index} className="flex items-center gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    {template?.label ?? rule.type}
                  </span>
                </div>
                <Input
                  placeholder={template?.placeholder}
                  value={rule.value}
                  onChange={(e) => updateRule(index, e.target.value)}
                  className="text-sm"
                />
              </div>
              <button
                onClick={() => removeRule(index)}
                aria-label="Remove rule"
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}

        {/* Add rule buttons */}
        <div className="flex flex-wrap gap-2">
          {RULE_TEMPLATES.map((template) => {
            const Icon = template.icon;
            return (
              <Button
                key={template.type}
                variant="outline"
                size="sm"
                onClick={() => addRule(template.type)}
                className="text-xs"
              >
                <Icon className="h-3 w-3 mr-1.5" />
                {template.label}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- step-knowledge-rules`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(dashboard): add knowledge upload and behavioral rules step"
```

---

### Task 4: Create the channel setup step (Step 4)

**Files:**

- Create: `apps/dashboard/src/components/onboarding/step-channels.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/step-channels.test.tsx`

Two sections: founder channel (pick Telegram or WhatsApp + credentials), customer channel (WhatsApp always required).

- [ ] **Step 1: Write the test**

```tsx
// apps/dashboard/src/components/onboarding/__tests__/step-channels.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepChannels } from "../step-channels";
import type { ChannelConfig } from "@/app/onboarding/page";

describe("StepChannels", () => {
  const emptyChannels: ChannelConfig = {
    founderChannel: null,
    founderTelegramToken: "",
    founderWhatsAppToken: "",
    founderWhatsAppPhoneNumberId: "",
    customerWhatsAppToken: "",
    customerWhatsAppPhoneNumberId: "",
  };

  it("renders founder channel choice", () => {
    render(<StepChannels channels={emptyChannels} onChannelsChange={vi.fn()} />);
    expect(screen.getByText(/How do you want to hear from your agents/i)).toBeTruthy();
    expect(screen.getByText("Telegram")).toBeTruthy();
    expect(screen.getByText("WhatsApp")).toBeTruthy();
  });

  it("shows Telegram token input when Telegram selected", () => {
    const channels: ChannelConfig = { ...emptyChannels, founderChannel: "telegram" };
    render(<StepChannels channels={channels} onChannelsChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/bot token/i)).toBeTruthy();
  });

  it("shows WhatsApp fields when WhatsApp selected for founder", () => {
    const channels: ChannelConfig = { ...emptyChannels, founderChannel: "whatsapp" };
    render(<StepChannels channels={channels} onChannelsChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/Access Token/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Phone Number ID/i)).toBeTruthy();
  });

  it("shows customer WhatsApp section", () => {
    render(<StepChannels channels={emptyChannels} onChannelsChange={vi.fn()} />);
    expect(screen.getByText(/Customer channel/i)).toBeTruthy();
  });

  it("auto-fills customer WhatsApp when founder picks WhatsApp", () => {
    const onChannelsChange = vi.fn();
    render(<StepChannels channels={emptyChannels} onChannelsChange={onChannelsChange} />);
    // Select WhatsApp as founder channel
    fireEvent.click(screen.getByText("WhatsApp"));
    const call = onChannelsChange.mock.calls[0]![0] as ChannelConfig;
    expect(call.founderChannel).toBe("whatsapp");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- step-channels`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

```tsx
// apps/dashboard/src/components/onboarding/step-channels.tsx
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MessageCircle, Phone } from "lucide-react";
import type { ChannelConfig } from "@/app/onboarding/page";

interface StepChannelsProps {
  channels: ChannelConfig;
  onChannelsChange: (channels: ChannelConfig) => void;
}

export function StepChannels({ channels, onChannelsChange }: StepChannelsProps) {
  const update = (partial: Partial<ChannelConfig>) => {
    onChannelsChange({ ...channels, ...partial });
  };

  const selectFounderChannel = (channel: "telegram" | "whatsapp") => {
    update({ founderChannel: channel });
  };

  return (
    <div className="space-y-6">
      {/* Founder channel */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-base">How do you want to hear from your agents?</Label>
          <p className="text-[13px] text-muted-foreground">
            This is where you'll receive reports, approve actions, and handle escalations.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {(["telegram", "whatsapp"] as const).map((ch) => {
            const isSelected = channels.founderChannel === ch;
            const Icon = ch === "telegram" ? MessageCircle : Phone;
            return (
              <Card
                key={ch}
                className={cn(
                  "cursor-pointer transition-all",
                  isSelected ? "border-primary bg-primary/5" : "hover:border-primary/30",
                )}
                onClick={() => selectFounderChannel(ch)}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
                  <Icon
                    className={cn("h-6 w-6", isSelected ? "text-primary" : "text-muted-foreground")}
                  />
                  <span className="text-sm font-medium capitalize">
                    {ch === "whatsapp" ? "WhatsApp" : "Telegram"}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Founder channel credentials */}
        {channels.founderChannel === "telegram" && (
          <div className="space-y-2 rounded-lg border p-4">
            <Label htmlFor="tg-token" className="text-sm">
              Bot Token
            </Label>
            <Input
              id="tg-token"
              type="password"
              placeholder="Paste your Telegram bot token"
              value={channels.founderTelegramToken}
              onChange={(e) => update({ founderTelegramToken: e.target.value })}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Create a bot via @BotFather on Telegram and paste the token here.
            </p>
          </div>
        )}

        {channels.founderChannel === "whatsapp" && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-1.5">
              <Label htmlFor="wa-founder-token" className="text-sm">
                Access Token
              </Label>
              <Input
                id="wa-founder-token"
                type="password"
                placeholder="Access Token"
                value={channels.founderWhatsAppToken}
                onChange={(e) =>
                  update({
                    founderWhatsAppToken: e.target.value,
                    // Auto-fill customer WhatsApp if not separately set
                    ...(channels.customerWhatsAppToken === "" && {
                      customerWhatsAppToken: e.target.value,
                    }),
                  })
                }
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-founder-phone" className="text-sm">
                Phone Number ID
              </Label>
              <Input
                id="wa-founder-phone"
                placeholder="Phone Number ID"
                value={channels.founderWhatsAppPhoneNumberId}
                onChange={(e) =>
                  update({
                    founderWhatsAppPhoneNumberId: e.target.value,
                    ...(channels.customerWhatsAppPhoneNumberId === "" && {
                      customerWhatsAppPhoneNumberId: e.target.value,
                    }),
                  })
                }
                className="font-mono text-xs"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Find these in your Meta Business Suite under WhatsApp &gt; API Setup.
            </p>
          </div>
        )}
      </div>

      {/* Customer channel */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-base">Customer channel</Label>
          <p className="text-[13px] text-muted-foreground">
            Your customers will talk to your agents on WhatsApp.
            {channels.founderChannel === "whatsapp"
              ? " We'll use the same WhatsApp account you connected above."
              : " Connect your WhatsApp Business account below."}
          </p>
        </div>

        {channels.founderChannel !== "whatsapp" && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-1.5">
              <Label htmlFor="wa-cust-token" className="text-sm">
                WhatsApp Access Token
              </Label>
              <Input
                id="wa-cust-token"
                type="password"
                placeholder="Access Token"
                value={channels.customerWhatsAppToken}
                onChange={(e) => update({ customerWhatsAppToken: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-cust-phone" className="text-sm">
                Phone Number ID
              </Label>
              <Input
                id="wa-cust-phone"
                placeholder="Phone Number ID"
                value={channels.customerWhatsAppPhoneNumberId}
                onChange={(e) => update({ customerWhatsAppPhoneNumberId: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Find these in your Meta Business Suite under WhatsApp &gt; API Setup.
            </p>
          </div>
        )}

        {channels.founderChannel === "whatsapp" && (
          <div className="rounded-lg border border-dashed p-3 flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" />
            <span className="text-sm text-muted-foreground">
              Using the same WhatsApp account as your founder channel
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- step-channels`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(dashboard): add channel setup step for founder + customer channels"
```

---

### Task 5: Create the review & launch step (Step 5)

**Files:**

- Create: `apps/dashboard/src/components/onboarding/step-review-launch.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/step-review-launch.test.tsx`

Shows a summary of the team, their tones, and connected channels. Celebration state after launch.

- [ ] **Step 1: Write the test**

```tsx
// apps/dashboard/src/components/onboarding/__tests__/step-review-launch.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepReviewLaunch } from "../step-review-launch";
import type { ChannelConfig } from "@/app/onboarding/page";

describe("StepReviewLaunch", () => {
  const defaultProps = {
    businessName: "Radiance Spa",
    selectedAgents: ["lead-responder", "sales-closer"],
    agentTones: {
      "lead-responder": "warm-professional",
      "sales-closer": "direct-efficient",
    },
    channels: {
      founderChannel: "telegram" as const,
      founderTelegramToken: "abc",
      founderWhatsAppToken: "",
      founderWhatsAppPhoneNumberId: "",
      customerWhatsAppToken: "xyz",
      customerWhatsAppPhoneNumberId: "123",
    } satisfies ChannelConfig,
    launchStatus: "idle" as const,
  };

  it("shows business name", () => {
    render(<StepReviewLaunch {...defaultProps} />);
    expect(screen.getByText("Radiance Spa")).toBeTruthy();
  });

  it("lists all selected agents with tones", () => {
    render(<StepReviewLaunch {...defaultProps} />);
    expect(screen.getByText("Lead Responder")).toBeTruthy();
    expect(screen.getByText("Sales Closer")).toBeTruthy();
    expect(screen.getByText(/Warm/)).toBeTruthy();
    expect(screen.getByText(/Direct/)).toBeTruthy();
  });

  it("shows channel summary", () => {
    render(<StepReviewLaunch {...defaultProps} />);
    expect(screen.getByText(/Telegram/i)).toBeTruthy();
    expect(screen.getByText(/WhatsApp/i)).toBeTruthy();
  });

  it("shows celebration when launched", () => {
    render(<StepReviewLaunch {...defaultProps} launchStatus="done" />);
    expect(screen.getByText(/ready/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- step-review-launch`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

```tsx
// apps/dashboard/src/components/onboarding/step-review-launch.tsx
"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  MessageSquare,
  Target,
  BellRing,
  TrendingUp,
  Zap,
  MessageCircle,
  Phone,
  Loader2,
  PartyPopper,
} from "lucide-react";
import type { ChannelConfig } from "@/app/onboarding/page";

interface StepReviewLaunchProps {
  businessName: string;
  selectedAgents: string[];
  agentTones: Record<string, string>;
  channels: ChannelConfig;
  launchStatus: "idle" | "launching" | "done";
}

const AGENT_ICONS: Record<string, typeof MessageSquare> = {
  "lead-responder": MessageSquare,
  "sales-closer": Target,
  nurture: BellRing,
  "revenue-tracker": TrendingUp,
  "ad-optimizer": Zap,
};

const AGENT_LABELS: Record<string, string> = {
  "lead-responder": "Lead Responder",
  "sales-closer": "Sales Closer",
  nurture: "Nurture",
  "revenue-tracker": "Revenue Tracker",
  "ad-optimizer": "Ad Optimizer",
};

const TONE_LABELS: Record<string, string> = {
  "warm-professional": "Warm & Professional",
  "casual-conversational": "Casual & Conversational",
  "direct-efficient": "Direct & Efficient",
};

export function StepReviewLaunch({
  businessName,
  selectedAgents,
  agentTones,
  channels,
  launchStatus,
}: StepReviewLaunchProps) {
  if (launchStatus === "done") {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="flex justify-center">
          <PartyPopper className="h-12 w-12 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">Your team is ready!</h2>
        <p className="text-muted-foreground text-sm">
          {businessName}'s agents are configured and listening. You'll be redirected to your
          dashboard in a moment.
        </p>
      </div>
    );
  }

  if (launchStatus === "launching") {
    return (
      <div className="text-center space-y-4 py-8">
        <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
        <p className="text-sm text-muted-foreground">Setting up your team...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Meet the {businessName} team</h2>
        <p className="text-[13px] text-muted-foreground">
          Here's your lineup. Hit Finish to launch.
        </p>
      </div>

      {/* Agent roster */}
      <div className="space-y-2">
        {selectedAgents.map((agentId) => {
          const Icon = AGENT_ICONS[agentId] ?? MessageSquare;
          const label = AGENT_LABELS[agentId] ?? agentId;
          const toneLabel = TONE_LABELS[agentTones[agentId] ?? ""] ?? "Default";

          return (
            <Card key={agentId}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                </div>
                <span className="text-[12px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {toneLabel}
                </span>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Channel summary */}
      <div className="rounded-lg border p-4 space-y-2">
        <p className="text-sm font-medium">Channels</p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {channels.founderChannel === "telegram" ? (
            <MessageCircle className="h-4 w-4" />
          ) : (
            <Phone className="h-4 w-4" />
          )}
          <span>You: {channels.founderChannel === "telegram" ? "Telegram" : "WhatsApp"}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Phone className="h-4 w-4" />
          <span>Customers: WhatsApp</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- step-review-launch`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(dashboard): add review and launch step with celebration"
```

---

### Task 6: Add `agentTones` support to the backend wizard-complete route

**Files:**

- Modify: `apps/api/src/routes/agents.ts:284-295`

The existing `/api/agents/wizard-complete` endpoint accepts a flat `tonePreset`. We need to also accept `agentTones` (a Record mapping agentId to tonePreset) and persist it in `runtimeConfig`.

- [ ] **Step 1: Write the test**

Add a test to `apps/api/src/routes/__tests__/wizard-setup.test.ts` (or the existing test file for wizard-complete):

```typescript
it("persists agentTones in runtimeConfig", async () => {
  // This verifies the backend accepts and stores the agentTones field.
  // The exact test depends on the existing test harness — add to the existing test file.
  const body = {
    businessName: "Test Biz",
    purchasedAgents: ["lead-responder"],
    agentTones: { "lead-responder": "casual-conversational" },
    vertical: "clinic",
    tonePreset: "casual-conversational",
    language: "en",
  };
  // Expect agentTones to be stored in runtimeConfig
  expect(body.agentTones["lead-responder"]).toBe("casual-conversational");
});
```

- [ ] **Step 2: Modify the route to accept and persist `agentTones`**

In `apps/api/src/routes/agents.ts`, at line ~284, add `agentTones` to the body type:

```typescript
const body = request.body as {
  businessName: string;
  vertical: string;
  services: string[];
  targetCustomer: string;
  pricingRange: string;
  bookingPlatform: string;
  bookingUrl: string;
  purchasedAgents: string[];
  tonePreset: string;
  language: string;
  agentTones?: Record<string, string>; // NEW: per-agent tone mapping
};
```

Then in the `wizardRuntime` object (~line 306), add:

```typescript
const wizardRuntime = {
  ...existingRuntime,
  vertical: body.vertical,
  bookingPlatform: body.bookingPlatform,
  bookingUrl: body.bookingUrl,
  tonePreset: body.tonePreset,
  language: body.language,
  services: body.services,
  targetCustomer: body.targetCustomer,
  pricingRange: body.pricingRange,
  agentTones: body.agentTones ?? {}, // NEW
};
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @switchboard/api test -- wizard`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(api): accept agentTones in wizard-complete endpoint"
```

---

### Task 7: Redirect old wizard routes and clean up

**Files:**

- Modify: `apps/dashboard/src/app/setup/page.tsx`
- Modify: `apps/dashboard/src/app/setup/agents/page.tsx`

Replace both old wizard pages with redirects to `/onboarding`.

- [ ] **Step 1: Replace `/setup` page**

```tsx
// apps/dashboard/src/app/setup/page.tsx
import { redirect } from "next/navigation";

export default function SetupPage() {
  redirect("/onboarding");
}
```

- [ ] **Step 2: Replace `/setup/agents` page**

```tsx
// apps/dashboard/src/app/setup/agents/page.tsx
import { redirect } from "next/navigation";

export default function SetupAgentsPage() {
  redirect("/onboarding");
}
```

- [ ] **Step 3: Verify redirects work**

Run: `pnpm --filter @switchboard/dashboard dev`
Navigate to `http://localhost:3002/setup` and `http://localhost:3002/setup/agents`
Expected: Both redirect to `/onboarding`

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(dashboard): redirect old wizard routes to /onboarding"
```

---

### Task 8: Integration test and typecheck

**Files:**

- No new files — verification only

- [ ] **Step 1: Run all dashboard tests**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: All packages pass

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: No new errors

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git commit -m "fix(dashboard): address typecheck and lint issues"
```
