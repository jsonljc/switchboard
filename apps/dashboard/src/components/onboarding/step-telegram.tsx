"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ExternalLink, MessageCircle } from "lucide-react";

interface StepTelegramProps {
  organizationId: string;
  ownerBotConnected: boolean;
  onOwnerBotConnected: () => void;
  leadBotToken: string;
  onLeadBotTokenChange: (token: string) => void;
  skipLeadBot: boolean;
  onSkipLeadBot: (skip: boolean) => void;
}

export function StepTelegram({
  organizationId,
  ownerBotConnected,
  onOwnerBotConnected,
  leadBotToken,
  onLeadBotTokenChange,
  skipLeadBot,
  onSkipLeadBot,
}: StepTelegramProps) {
  const [showLeadSetup, setShowLeadSetup] = useState(false);
  const botDeepLink = `https://t.me/SwitchboardBot?start=org_${organizationId}`;

  return (
    <div className="space-y-6">
      {/* Owner bot */}
      <div className="space-y-3">
        <Label className="text-base font-semibold">Connect your Telegram</Label>
        <p className="text-sm text-muted-foreground">
          This is where you&apos;ll receive daily reports, approve actions, and manage your
          campaigns.
        </p>

        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-blue-500" />
            <span className="font-medium text-sm">Switchboard Bot</span>
          </div>

          {ownerBotConnected ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Connected to Telegram
            </div>
          ) : (
            <>
              <ol className="list-decimal list-inside text-xs text-muted-foreground space-y-1">
                <li>Open Telegram on your phone</li>
                <li>Click the link below to start the bot</li>
                <li>Send the start command to connect your account</li>
              </ol>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    window.open(botDeepLink, "_blank");
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Open in Telegram
                </Button>
                <Button variant="ghost" size="sm" onClick={onOwnerBotConnected}>
                  I&apos;ve connected
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Lead bot (optional) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Lead Response Bot (optional)</Label>
          {!showLeadSetup && !skipLeadBot && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => onSkipLeadBot(true)}
            >
              Skip for now
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Create a separate Telegram bot to automatically respond to leads from your ads. This bot
          answers questions, qualifies leads, and books appointments.
        </p>

        {skipLeadBot ? (
          <div className="rounded-lg border border-dashed p-3">
            <p className="text-xs text-muted-foreground">
              You can set up a lead bot later from Settings.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs mt-1"
              onClick={() => onSkipLeadBot(false)}
            >
              Set up now instead
            </Button>
          </div>
        ) : !showLeadSetup ? (
          <Button variant="outline" size="sm" onClick={() => setShowLeadSetup(true)}>
            Set up lead bot
          </Button>
        ) : (
          <div className="rounded-lg border p-4 space-y-3">
            <ol className="list-decimal list-inside text-xs text-muted-foreground space-y-1">
              <li>Open Telegram and message @BotFather</li>
              <li>
                Send <code className="px-1 py-0.5 bg-muted rounded">/newbot</code> and follow the
                prompts
              </li>
              <li>Name it something like &quot;[Your Business] Assistant&quot;</li>
              <li>Copy the bot token and paste it below</li>
            </ol>
            <div className="space-y-1.5">
              <Label htmlFor="lead-bot-token" className="text-xs">
                Bot Token
              </Label>
              <Input
                id="lead-bot-token"
                type="password"
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                value={leadBotToken}
                onChange={(e) => onLeadBotTokenChange(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            {leadBotToken && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                Token saved
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
