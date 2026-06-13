import type { Metadata } from "next";
import { PaymentResultCard } from "@/components/payment/payment-result-card";

export const metadata: Metadata = {
  title: "Payment canceled",
  robots: { index: false, follow: false },
};

export default function PaymentCancelPage() {
  return <PaymentResultCard variant="cancel" />;
}
