"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Phone, Mail, Clock, Bot } from "lucide-react";

export interface StorefrontData {
  slug: string;
  businessName: string;
  agentName: string;
  scannedProfile: Record<string, unknown> | null;
  widgetToken: string | null;
  listingSlug: string;
}

interface StorefrontPageProps {
  data: StorefrontData;
}

function getServices(profile: Record<string, unknown> | null): string[] {
  if (!profile) return [];
  const services = profile.services;
  if (Array.isArray(services)) return services.filter((s) => typeof s === "string") as string[];
  return [];
}

interface Product {
  name: string;
  price: string | null;
}

function getProducts(profile: Record<string, unknown> | null): Product[] {
  if (!profile) return [];
  const products = profile.products;
  if (!Array.isArray(products)) return [];
  return products
    .filter((p) => typeof p === "object" && p !== null)
    .map((p) => {
      const item = p as Record<string, unknown>;
      return {
        name: typeof item.name === "string" ? item.name : String(item.name ?? ""),
        price: typeof item.price === "string" ? item.price : null,
      };
    })
    .filter((p) => p.name);
}

export function StorefrontPage({ data }: StorefrontPageProps) {
  const { businessName, agentName, scannedProfile, widgetToken } = data;

  const description =
    typeof scannedProfile?.description === "string" ? scannedProfile.description : null;
  const services = getServices(scannedProfile);
  const products = getProducts(scannedProfile);

  const location = typeof scannedProfile?.location === "string" ? scannedProfile.location : null;
  const phone = typeof scannedProfile?.phone === "string" ? scannedProfile.phone : null;
  const email = typeof scannedProfile?.email === "string" ? scannedProfile.email : null;
  const hours = typeof scannedProfile?.hours === "string" ? scannedProfile.hours : null;

  const chatServerUrl = process.env.NEXT_PUBLIC_CHAT_SERVER_URL || "http://localhost:3001";

  return (
    <div className="pt-24 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-foreground">{businessName}</h1>
          {description && (
            <p className="mt-3 text-lg text-muted-foreground leading-relaxed">{description}</p>
          )}
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
          {/* Left — business info */}
          <div className="lg:col-span-3 space-y-6">
            {/* Services */}
            {services.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Services</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {services.map((service) => (
                      <Badge key={service} variant="secondary">
                        {service}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Products */}
            {products.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Products</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y divide-border">
                    {products.map((product, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
                      >
                        <span className="text-sm text-foreground">{product.name}</span>
                        {product.price && (
                          <span className="text-sm font-medium text-foreground">
                            {product.price}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Contact info */}
            {(location || phone || email || hours) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Contact &amp; Hours</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {location && (
                    <div className="flex items-start gap-3 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <span>{location}</span>
                    </div>
                  )}
                  {phone && (
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <a href={`tel:${phone}`} className="hover:text-foreground transition-colors">
                        {phone}
                      </a>
                    </div>
                  )}
                  {email && (
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <a
                        href={`mailto:${email}`}
                        className="hover:text-foreground transition-colors"
                      >
                        {email}
                      </a>
                    </div>
                  )}
                  {hours && (
                    <div className="flex items-start gap-3 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <span className="whitespace-pre-line">{hours}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right — sticky chat widget */}
          <div className="lg:col-span-2">
            <div className="sticky top-28">
              <Card className="overflow-hidden shadow-md">
                <CardHeader className="pb-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-medium">{agentName}</CardTitle>
                      <p className="text-xs text-muted-foreground">Chat with us</p>
                    </div>
                    <span className="ml-auto flex h-2 w-2 rounded-full bg-green-500" />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {widgetToken ? (
                    <iframe
                      src={`${chatServerUrl}/widget/${widgetToken}/embed`}
                      className="w-full h-[480px] border-none"
                      title={`Chat with ${agentName}`}
                      allow="microphone"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-[480px] gap-3 text-center px-6">
                      <Bot className="h-10 w-10 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">
                        Chat is not yet configured for this agent.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Powered by footer */}
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Powered by{" "}
                <a
                  href="https://switchboard.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors font-medium"
                >
                  Switchboard
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
