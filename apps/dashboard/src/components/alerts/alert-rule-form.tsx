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
import type { CreateAlertInput } from "@/lib/api-client";

interface AlertRuleFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateAlertInput) => void;
  isLoading?: boolean;
}

const metricPaths = [
  { value: "primaryKPI.current", label: "Primary KPI (Current)" },
  { value: "primaryKPI.deltaPercent", label: "Primary KPI (% Change)" },
  { value: "spend.current", label: "Spend (Current)" },
  { value: "findings.critical.count", label: "Critical Findings Count" },
  { value: "findings.warning.count", label: "Warning Findings Count" },
  { value: "bottleneck.deltaPercent", label: "Bottleneck (% Change)" },
];

const operators = [
  { value: "gt", label: "> (greater than)" },
  { value: "gte", label: ">= (greater or equal)" },
  { value: "lt", label: "< (less than)" },
  { value: "lte", label: "<= (less or equal)" },
  { value: "eq", label: "= (equal)" },
  { value: "pctChange_gt", label: "|%| > (abs % change greater)" },
  { value: "pctChange_lt", label: "|%| < (abs % change less)" },
];

export function AlertRuleForm({ open, onClose, onSubmit, isLoading }: AlertRuleFormProps) {
  const [name, setName] = useState("");
  const [metricPath, setMetricPath] = useState("primaryKPI.current");
  const [operator, setOperator] = useState("gt");
  const [threshold, setThreshold] = useState("");
  const [platform, setPlatform] = useState("");
  const [cooldownMinutes, setCooldownMinutes] = useState("60");
  const [notifyChannels, setNotifyChannels] = useState("");
  const [notifyRecipients, setNotifyRecipients] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      metricPath,
      operator,
      threshold: parseFloat(threshold),
      platform: platform || undefined,
      cooldownMinutes: parseInt(cooldownMinutes, 10) || 60,
      notifyChannels: notifyChannels ? notifyChannels.split(",").map((s) => s.trim()) : [],
      notifyRecipients: notifyRecipients ? notifyRecipients.split(",").map((s) => s.trim()) : [],
    });
    // Reset form
    setName("");
    setThreshold("");
    setPlatform("");
    setNotifyChannels("");
    setNotifyRecipients("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Alert Rule</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Metric</Label>
              <Select value={metricPath} onValueChange={setMetricPath}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {metricPaths.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Operator</Label>
              <Select value={operator} onValueChange={setOperator}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {operators.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="threshold">Threshold</Label>
              <Input id="threshold" type="number" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="cooldown">Cooldown (minutes)</Label>
              <Input id="cooldown" type="number" value={cooldownMinutes} onChange={(e) => setCooldownMinutes(e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="platform">Platform (optional)</Label>
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

          <div>
            <Label htmlFor="channels">Notify Channels (comma-separated)</Label>
            <Input id="channels" placeholder="slack, telegram, whatsapp" value={notifyChannels} onChange={(e) => setNotifyChannels(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="recipients">Notify Recipients (comma-separated IDs)</Label>
            <Input id="recipients" placeholder="U123, C456" value={notifyRecipients} onChange={(e) => setNotifyRecipients(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isLoading || !name || !threshold}>
              {isLoading ? "Creating..." : "Create Alert"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
