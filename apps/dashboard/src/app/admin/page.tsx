"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Save, AlertTriangle } from "lucide-react";

interface OrgConfig {
  id: string;
  name: string;
  governanceProfile: string;
  runtimeType: string;
  onboardingComplete: boolean;
}

const governanceProfiles = [
  { value: "permissive", label: "Permissive", description: "Minimal guardrails, auto-approve most actions" },
  { value: "guarded", label: "Guarded", description: "Standard guardrails with risk-based approvals" },
  { value: "strict", label: "Strict", description: "All side effects require approval" },
];

export default function AdminPage() {
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [name, setName] = useState("");
  const [governanceProfile, setGovernanceProfile] = useState("guarded");
  const [runtimeType, setRuntimeType] = useState("embedded");

  useEffect(() => {
    fetch("/api/dashboard/admin")
      .then((res) => res.json())
      .then((data) => {
        if (data.config) {
          setConfig(data.config);
          setName(data.config.name ?? "");
          setGovernanceProfile(data.config.governanceProfile ?? "guarded");
          setRuntimeType(data.config.runtimeType ?? "embedded");
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/dashboard/admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, governanceProfile, runtimeType }),
      });
      setConfig((prev) => prev ? { ...prev, name, governanceProfile, runtimeType } : prev);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Organization Settings</h1>
        <p className="text-muted-foreground">
          Manage your organization configuration, governance profile, and runtime settings.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="org-name">Organization Name</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Organization"
              />
            </div>

            <div>
              <Label>Governance Profile</Label>
              <Select value={governanceProfile} onValueChange={setGovernanceProfile}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {governanceProfiles.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {governanceProfiles.find((p) => p.value === governanceProfile)?.description}
              </p>
            </div>

            <div>
              <Label>Runtime Type</Label>
              <Select value={runtimeType} onValueChange={setRuntimeType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="embedded">Embedded</SelectItem>
                  <SelectItem value="managed">Managed</SelectItem>
                  <SelectItem value="standalone">Standalone</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Organization ID</span>
              <span className="font-mono text-xs">{config?.id ?? "N/A"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Onboarding</span>
              <Badge variant={config?.onboardingComplete ? "default" : "secondary"}>
                {config?.onboardingComplete ? "Complete" : "Incomplete"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Governance</span>
              <Badge variant="outline">{governanceProfile}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Runtime</span>
              <Badge variant="outline">{runtimeType}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-lg text-destructive flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            These actions are destructive and cannot be undone.
          </p>
          <Button
            variant="destructive"
            onClick={() => setResetConfirm(true)}
          >
            Reset Organization Data
          </Button>
        </CardContent>
      </Card>

      <Dialog open={resetConfirm} onOpenChange={(v) => !v && setResetConfirm(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Organization Data</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will delete all audit logs, approval history, and cached data for your organization.
            Policies and connections will be preserved. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => setResetConfirm(false)}>
              Confirm Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
