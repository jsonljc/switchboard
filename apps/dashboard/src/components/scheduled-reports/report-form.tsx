"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { CreateScheduledReportInput } from "@/lib/api-client";

interface ReportFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateScheduledReportInput) => void;
  isLoading?: boolean;
}

export function ReportForm({ open, onClose, onSubmit, isLoading }: ReportFormProps) {
  const [name, setName] = useState("");
  const [cronExpression, setCronExpression] = useState("0 9 * * 1");
  const [timezone, setTimezone] = useState("UTC");
  const [reportType, setReportType] = useState<"funnel" | "portfolio">("funnel");
  const [platform, setPlatform] = useState("");
  const [deliveryChannels, setDeliveryChannels] = useState("");
  const [deliveryTargets, setDeliveryTargets] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      cronExpression,
      timezone,
      reportType,
      platform: platform || undefined,
      deliveryChannels: deliveryChannels ? deliveryChannels.split(",").map((s) => s.trim()) : [],
      deliveryTargets: deliveryTargets ? deliveryTargets.split(",").map((s) => s.trim()) : [],
    });
    setName("");
    setCronExpression("0 9 * * 1");
    setDeliveryChannels("");
    setDeliveryTargets("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Scheduled Report</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="cron">Cron Expression</Label>
              <Input id="cron" value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} placeholder="0 9 * * 1" required />
              <p className="text-xs text-muted-foreground mt-1">e.g. "0 9 * * 1" = Mon 9am</p>
            </div>
            <div>
              <Label htmlFor="tz">Timezone</Label>
              <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Report Type</Label>
              <Select value={reportType} onValueChange={(v) => setReportType(v as "funnel" | "portfolio")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="funnel">Funnel Diagnostic</SelectItem>
                  <SelectItem value="portfolio">Portfolio Diagnostic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Platform (optional)</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger><SelectValue placeholder="All platforms" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  <SelectItem value="meta">Meta</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="channels">Delivery Channels (comma-separated)</Label>
            <Input id="channels" placeholder="slack, telegram, whatsapp" value={deliveryChannels} onChange={(e) => setDeliveryChannels(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="targets">Delivery Targets (comma-separated IDs)</Label>
            <Input id="targets" placeholder="U123, C456" value={deliveryTargets} onChange={(e) => setDeliveryTargets(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isLoading || !name || !cronExpression}>
              {isLoading ? "Creating..." : "Create Report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
