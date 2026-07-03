import { startCustomerPortalSession } from "@/app/(dashboard)/settings/billing-action";
import { CreditCard, AlertTriangle, ArrowUpRight } from "lucide-react";

interface BillingAlertBannerProps {
  reason: "past_due" | "usage_limit_exceeded";
  tier: string;
  usage: number;
  max: number;
}

export default function BillingAlertBanner({
  reason,
  tier,
  usage,
  max,
}: BillingAlertBannerProps) {
  return (
    <div
      className={`mb-6 border p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in slide-in-from-top-4 duration-300 ${
        reason === "past_due"
          ? "bg-red-950/20 border-red-900/40 text-red-400"
          : "bg-amber-950/20 border-amber-900/40 text-amber-400"
      }`}
    >
      <div className="flex items-start gap-3">
        {reason === "past_due" ? (
          <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-500" />
        ) : (
          <CreditCard className="h-5 w-5 mt-0.5 flex-shrink-0 text-amber-500" />
        )}
        <div>
          <h4 className="text-sm font-bold uppercase tracking-wide">
            {reason === "past_due" && tier !== "Free Tier"
              ? "Subscription Suspended"
              : "Usage Threshold Reached"}
          </h4>
          <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
            {reason === "past_due" && tier !== "Free Tier"
              ? "Your latest corporate payment transaction failed. Please process payment configuration details to restore administrative functionality."
              : `Your workspace has consumed ${usage} out of ${max} permitted operations allocated to the standard ${tier}. Upgrade to prevent account locks.`}
          </p>
        </div>
      </div>

      <form action={startCustomerPortalSession}>
        <button
          type="submit"
          className={`h-8 px-4 rounded-md text-xs font-semibold tracking-wide inline-flex items-center gap-1.5 transition-colors whitespace-nowrap self-end sm:self-center ${
            reason === "past_due"
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-amber-500 hover:bg-amber-600 text-zinc-950"
          }`}
        >
          Resolve Billing System
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
