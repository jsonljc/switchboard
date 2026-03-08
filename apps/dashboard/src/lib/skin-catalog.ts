import { Stethoscope, Dumbbell, ShoppingBag, Briefcase } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface SkinCatalogEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  requiredCartridges: string[];
}

export const SKIN_CATALOG: SkinCatalogEntry[] = [
  {
    id: "clinic",
    label: "Healthcare / Dental",
    icon: Stethoscope,
    description: "Clinics, dental practices, medical offices — appointment-based businesses.",
    requiredCartridges: ["customer-engagement", "crm", "digital-ads"],
  },
  {
    id: "gym",
    label: "Fitness / Wellness",
    icon: Dumbbell,
    description: "Gyms, studios, personal trainers — membership and class-based businesses.",
    requiredCartridges: ["customer-engagement", "crm", "digital-ads"],
  },
  {
    id: "commerce",
    label: "E-Commerce / Retail",
    icon: ShoppingBag,
    description: "Online stores, retail shops — product-based businesses.",
    requiredCartridges: ["digital-ads", "payments", "crm"],
  },
  {
    id: "generic",
    label: "Other Business",
    icon: Briefcase,
    description: "Any business type — we'll customize the experience for you.",
    requiredCartridges: ["customer-engagement", "crm"],
  },
];
