import { redirect } from "next/navigation";

// The /alex cockpit was retired in favor of the read-only agent panel. This route
// redirects to Home's `?agent=` deep-link, which auto-opens the Alex panel.
export default async function AlexPage() {
  redirect("/?agent=alex");
}
