"use client";

import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sparkles, MessageCircle, Zap } from "lucide-react";

interface StepToneLanguageProps {
  tone: string;
  onToneChange: (tone: string) => void;
  language: string;
  onLanguageChange: (lang: string) => void;
}

const TONES = [
  {
    id: "warm-professional",
    label: "Warm & Professional",
    description: "Friendly yet polished — ideal for healthcare & wellness",
    icon: Sparkles,
  },
  {
    id: "casual-conversational",
    label: "Casual & Conversational",
    description: "Relaxed and approachable — like texting a friend",
    icon: MessageCircle,
  },
  {
    id: "direct-efficient",
    label: "Direct & Efficient",
    description: "Straight to the point — no fluff",
    icon: Zap,
  },
];

const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ms", label: "Malay" },
  { id: "zh", label: "Chinese" },
  { id: "en-sg", label: "Singlish" },
];

export function StepToneLanguage({
  tone,
  onToneChange,
  language,
  onLanguageChange,
}: StepToneLanguageProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Choose your agent's tone</Label>
        <div className="grid grid-cols-1 gap-3">
          {TONES.map((t) => {
            const Icon = t.icon;
            const isSelected = tone === t.id;
            return (
              <Card
                key={t.id}
                className={cn(
                  "cursor-pointer transition-all",
                  isSelected
                    ? "border-foreground/60 bg-surface shadow-sm"
                    : "hover:bg-surface hover:border-border-subtle",
                )}
                onClick={() => onToneChange(t.id)}
              >
                <CardContent className="p-4 flex items-start gap-3">
                  <div
                    className={cn(
                      "flex items-center justify-center h-9 w-9 rounded-lg flex-shrink-0",
                      isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{t.label}</p>
                    <p className="text-[13px] text-muted-foreground mt-1">{t.description}</p>
                  </div>
                  {isSelected && (
                    <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center">
                      <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Primary language</Label>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((lang) => {
            const isSelected = language === lang.id;
            return (
              <Button
                key={lang.id}
                variant={isSelected ? "default" : "outline"}
                size="sm"
                onClick={() => onLanguageChange(lang.id)}
                className={cn(
                  "min-w-[80px]",
                  !isSelected && "hover:bg-surface hover:border-border-subtle",
                )}
              >
                {lang.label}
              </Button>
            );
          })}
        </div>
        <p className="text-[12px] text-muted-foreground">
          Agents will respond in this language by default
        </p>
      </div>
    </div>
  );
}
