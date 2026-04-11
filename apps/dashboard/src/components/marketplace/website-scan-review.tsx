"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ScannedProfile {
  businessName: string;
  description: string;
  products: Array<{ name: string; description: string; price?: string }>;
  services: string[];
  location?: { address: string; city: string; state: string };
  hours?: Record<string, string>;
  phone?: string;
  email?: string;
  faqs: Array<{ question: string; answer: string }>;
  brandLanguage: string[];
  platformDetected?: string;
}

interface WebsiteScanReviewProps {
  profile: ScannedProfile;
  onConfirm: (edited: ScannedProfile) => void;
  onBack?: () => void;
}

export function WebsiteScanReview({ profile, onConfirm, onBack }: WebsiteScanReviewProps) {
  const [businessName, setBusinessName] = useState(profile.businessName);
  const [description, setDescription] = useState(profile.description);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [email, setEmail] = useState(profile.email ?? "");

  function handleConfirm() {
    onConfirm({
      ...profile,
      businessName,
      description,
      phone: phone || undefined,
      email: email || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          Here's what I found on your website. Adjust anything that looks off.
        </p>
      </div>

      {/* Editable fields */}
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="businessName">Business Name</Label>
          <Input
            id="businessName"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 000-0000"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hello@yourbusiness.com"
            />
          </div>
        </div>
      </div>

      {/* Platform detected */}
      {profile.platformDetected && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Platform detected:</span>
          <Badge variant="secondary">{profile.platformDetected}</Badge>
        </div>
      )}

      {/* Products */}
      {profile.products.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Products</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {profile.products.map((product, i) => (
              <div key={i} className="rounded-md border border-border p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{product.name}</span>
                  {product.price && (
                    <Badge variant="outline" className="shrink-0">
                      {product.price}
                    </Badge>
                  )}
                </div>
                {product.description && (
                  <p className="text-xs text-muted-foreground">{product.description}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Services */}
      {profile.services.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Services</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {profile.services.map((service, i) => (
                <Badge key={i} variant="secondary">
                  {service}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Brand language */}
      {profile.brandLanguage.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Brand Language</p>
          <div className="flex flex-wrap gap-2">
            {profile.brandLanguage.map((word, i) => (
              <Badge key={i} variant="outline">
                {word}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        {onBack && (
          <Button variant="outline" onClick={onBack} className="flex-1">
            Back
          </Button>
        )}
        <Button onClick={handleConfirm} className="flex-1" disabled={!businessName.trim()}>
          Looks Good — Continue
        </Button>
      </div>
    </div>
  );
}
