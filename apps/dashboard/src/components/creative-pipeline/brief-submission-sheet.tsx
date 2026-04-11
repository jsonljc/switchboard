"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/use-toast";
import { useSubmitBrief } from "@/hooks/use-creative-pipeline";
import { UrlListInput } from "./url-list-input";

const PLATFORMS = [
  { value: "meta", label: "Meta" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
] as const;

interface BriefSubmissionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deploymentId: string;
  listingId: string;
}

interface FormErrors {
  productDescription?: string;
  targetAudience?: string;
  platforms?: string;
}

export function BriefSubmissionSheet({
  open,
  onOpenChange,
  deploymentId,
  listingId,
}: BriefSubmissionSheetProps) {
  const { toast } = useToast();
  const submitMutation = useSubmitBrief();

  const [productDescription, setProductDescription] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [brandVoice, setBrandVoice] = useState("");
  const [productImages, setProductImages] = useState<string[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const [generateReferenceImages, setGenerateReferenceImages] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    if (!productDescription.trim())
      newErrors.productDescription = "Product description is required";
    if (!targetAudience.trim()) newErrors.targetAudience = "Target audience is required";
    if (platforms.length === 0) newErrors.platforms = "Select at least one platform";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleTogglePlatform = (platform: string) => {
    setPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
    );
  };

  const resetForm = () => {
    setProductDescription("");
    setTargetAudience("");
    setPlatforms([]);
    setBrandVoice("");
    setProductImages([]);
    setReferences([]);
    setGenerateReferenceImages(false);
    setErrors({});
  };

  const handleSubmit = () => {
    if (!validate()) return;

    submitMutation.mutate(
      {
        deploymentId,
        listingId,
        brief: {
          productDescription: productDescription.trim(),
          targetAudience: targetAudience.trim(),
          platforms,
          brandVoice: brandVoice.trim() || null,
          productImages,
          references,
          generateReferenceImages,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Creative job started", description: "Pipeline is now running." });
          resetForm();
          onOpenChange(false);
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to create creative job. Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New Creative Job</SheetTitle>
          <SheetDescription>Submit a brief to start the creative pipeline.</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-6">
          {/* Product Description */}
          <div className="space-y-2">
            <Label className="text-[13px]">
              Product Description <span className="text-red-500">*</span>
            </Label>
            <Textarea
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              placeholder="Describe the product or service..."
              className="text-[13px] min-h-[80px]"
            />
            {errors.productDescription && (
              <p className="text-[12px] text-red-500">{errors.productDescription}</p>
            )}
          </div>

          {/* Target Audience */}
          <div className="space-y-2">
            <Label className="text-[13px]">
              Target Audience <span className="text-red-500">*</span>
            </Label>
            <Textarea
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              placeholder="Who is this ad targeting?"
              className="text-[13px] min-h-[80px]"
            />
            {errors.targetAudience && (
              <p className="text-[12px] text-red-500">{errors.targetAudience}</p>
            )}
          </div>

          {/* Platforms */}
          <div className="space-y-2">
            <Label className="text-[13px]">
              Platforms <span className="text-red-500">*</span>
            </Label>
            <div className="flex gap-4">
              {PLATFORMS.map((p) => (
                <label key={p.value} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={platforms.includes(p.value)}
                    onCheckedChange={() => handleTogglePlatform(p.value)}
                  />
                  <span className="text-[13px]">{p.label}</span>
                </label>
              ))}
            </div>
            {errors.platforms && <p className="text-[12px] text-red-500">{errors.platforms}</p>}
          </div>

          {/* Brand Voice */}
          <div className="space-y-2">
            <Label className="text-[13px]">Brand Voice</Label>
            <Textarea
              value={brandVoice}
              onChange={(e) => setBrandVoice(e.target.value)}
              placeholder="Describe the brand's tone and voice (optional)"
              className="text-[13px] min-h-[60px]"
            />
          </div>

          {/* Product Images */}
          <UrlListInput
            value={productImages}
            onChange={setProductImages}
            label="Product Images"
            placeholder="Paste image URL..."
          />

          {/* References */}
          <UrlListInput
            value={references}
            onChange={setReferences}
            label="References"
            placeholder="Paste reference URL..."
          />

          {/* Generate Reference Images */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-[13px]">Generate Reference Images</Label>
              <p className="text-[12px] text-muted-foreground">
                AI-generated visuals for each storyboard scene
              </p>
            </div>
            <Switch
              checked={generateReferenceImages}
              onCheckedChange={setGenerateReferenceImages}
            />
          </div>

          {/* Submit */}
          <Button onClick={handleSubmit} disabled={submitMutation.isPending} className="w-full">
            {submitMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Job
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
