"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MessageCircle, Phone } from "lucide-react";
import type { ChannelConfig } from "@/app/(auth)/onboarding/page";

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
