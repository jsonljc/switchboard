import type { Metadata } from "next";
import { PaymentResultCard } from "@/components/payment/payment-result-card";

export const metadata: Metadata = {
  title: "Payment complete",
  robots: { index: false, follow: false },
};

export default function PaymentSuccessPage() {
  return <PaymentResultCard variant="success" />;
}
