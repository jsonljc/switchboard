import { REQUIRED_SECTIONS, RECOMMENDED_SECTIONS, type Playbook } from "@switchboard/schemas";
import {
  parseBusinessIdentityResponse,
  parseServicesResponse,
  parseEscalationTriggers,
} from "./interview-parsers";

export type QuestionType = "ask" | "confirm" | "collect";

export interface InterviewQuestion {
  id: string;
  targetSection: string;
  type: QuestionType;
  prompt: string;
  contextHint: string;
}

export interface ResponseUpdate {
  section: string;
  fields: Record<string, unknown>;
  newStatus: "ready" | "check_this";
}

const CATEGORY_HINTS: Record<string, string> = {
  dental: "dental clinic or practice",
  salon: "hair salon or beauty studio",
  fitness: "gym, fitness studio, or personal training",
  med_spa: "medical spa or aesthetic clinic",
  coaching: "coaching or consulting practice",
  other: "service business",
};

const SECTION_QUESTIONS: Record<string, { ask: string; confirm: string; collect: string }> = {
  businessIdentity: {
    ask: "What's your business called, and what do you do?",
    confirm: "I found your business details. Does this look right, or should I adjust anything?",
    collect: "What's the best way to describe what your business offers?",
  },
  services: {
    ask: "What services do you offer? Include prices and duration if you have them.",
    confirm: "I found these services on your site. Are they accurate? Any missing?",
    collect: "Tell me about your most popular service — name, price, and how long it takes.",
  },
  hours: {
    ask: "What are your operating hours? And what should Alex do when someone messages after hours?",
    confirm: "I found these hours on your site. Look right?",
    collect: "What days and times are you open?",
  },
  bookingRules: {
    ask: "When someone wants to book, should Alex qualify them first or go straight to scheduling?",
    confirm:
      "Here's how I'd handle booking requests based on your site. Does this match how you work?",
    collect: "How do you want Alex to handle booking requests?",
  },
  approvalMode: {
    ask: "For bookings and pricing questions — should Alex handle them directly, or check with you first?",
    confirm: "I've set these default behaviors. Want to adjust any?",
    collect: "How much autonomy should Alex have?",
  },
  escalation: {
    ask: "Are there any situations where Alex should always hand off to you? Like complaints, refund requests, or specific topics?",
    confirm: "I've set some default escalation rules. Want to refine them?",
    collect: "What topics should Alex always escalate to you?",
  },
  channels: {
    ask: "Which messaging channel do your customers use most — WhatsApp, Telegram, or something else?",
    confirm: "I found contact methods on your site. Which channels should Alex operate on?",
    collect: "Where do your customers usually reach you?",
  },
};

export class InterviewEngine {
  private playbook: Playbook;
  private category: string | undefined;
  private askedSections: Set<string> = new Set();

  constructor(playbook: Playbook, category?: string) {
    this.playbook = playbook;
    this.category = category;
  }

  getNextQuestion(): InterviewQuestion | null {
    for (const section of REQUIRED_SECTIONS) {
      const status = this.getSectionStatus(section);
      if (status === "ready") continue;
      if (this.askedSections.has(section)) continue;
      return this.buildQuestion(section, status);
    }

    for (const section of RECOMMENDED_SECTIONS) {
      const status = this.getSectionStatus(section);
      if (status === "ready") continue;
      if (this.askedSections.has(section)) continue;
      return this.buildQuestion(section, status);
    }

    return null;
  }

  markAsked(section: string): void {
    this.askedSections.add(section);
  }

  processResponse(question: InterviewQuestion, response: string): ResponseUpdate {
    this.askedSections.add(question.targetSection);
    const section = question.targetSection;
    const text = response.trim();

    switch (section) {
      case "businessIdentity": {
        const parsed = parseBusinessIdentityResponse(text);
        return {
          section,
          fields: parsed ?? { unparsedInput: text },
          newStatus: "check_this",
        };
      }
      case "services": {
        const parsed = parseServicesResponse(text);
        return {
          section,
          fields: parsed ? { services: parsed } : { unparsedInput: text },
          newStatus: "check_this",
        };
      }
      case "hours": {
        return {
          section,
          fields: { unparsedInput: text },
          newStatus: "check_this",
        };
      }
      case "bookingRules": {
        return {
          section,
          fields: { leadVsBooking: text },
          newStatus: "check_this",
        };
      }
      case "escalation": {
        const triggers = parseEscalationTriggers(text);
        return {
          section,
          fields: triggers ? { triggers } : { unparsedInput: text },
          newStatus: "check_this",
        };
      }
      default: {
        return {
          section,
          fields: { unparsedInput: text },
          newStatus: "check_this",
        };
      }
    }
  }

  private getSectionStatus(section: string): string {
    const sectionData = this.playbook[section as keyof Playbook];
    if (!sectionData || typeof sectionData !== "object") return "missing";
    if (Array.isArray(sectionData)) {
      // For services array, check if any service is ready
      if (sectionData.length > 0 && sectionData.some((s) => s.status === "ready")) {
        return "ready";
      }
      return sectionData.length > 0 ? "check_this" : "missing";
    }
    return (sectionData as { status: string }).status;
  }

  private buildQuestion(section: string, status: string): InterviewQuestion {
    const templates = SECTION_QUESTIONS[section];
    if (!templates) {
      return {
        id: `q-${section}`,
        targetSection: section,
        type: "ask",
        prompt: `Tell me about your ${section}.`,
        contextHint: "",
      };
    }

    const type: QuestionType = status === "check_this" ? "confirm" : "ask";
    const prompt = type === "confirm" ? templates.confirm : templates.ask;
    const categoryHint = this.category ? (CATEGORY_HINTS[this.category] ?? this.category) : "";

    return {
      id: `q-${section}`,
      targetSection: section,
      type,
      prompt,
      contextHint: categoryHint ? `The user runs a ${categoryHint}.` : "",
    };
  }
}
