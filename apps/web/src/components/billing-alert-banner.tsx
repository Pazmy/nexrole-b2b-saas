import Link from "next/link";
import { CreditCard, AlertTriangle, ArrowUpRight } from "lucide-react";

interface BillingAlertBannerProps {
  reason: "subscription_restricted" | "usage_limit_exceeded";
  tier: string;
  usage: number;
  max: number | null;
  canManageBilling: boolean;
}

export default function BillingAlertBanner({
  reason,
  tier,
  usage,
  max,
  canManageBilling,
}: BillingAlertBannerProps) {
  return (
    <div
      className={`mb-6 border p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in slide-in-from-top-4 duration-300 ${
        reason === "subscription_restricted"
          ? "bg-red-950/20 border-red-900/40 text-red-400"
          : "bg-amber-950/20 border-amber-900/40 text-amber-400"
      }`}
    >
      <div className="flex items-start gap-3">
        {reason === "subscription_restricted" ? (
          <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-500" />
        ) : (
          <CreditCard className="h-5 w-5 mt-0.5 flex-shrink-0 text-amber-500" />
        )}
        <div>
          <h4 className="text-sm font-bold uppercase tracking-wide">
            {reason === "subscription_restricted"
              ? "Transaction Writes Restricted"
              : "Usage Threshold Reached"}
          </h4>
          <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
            {reason === "subscription_restricted"
              ? "Your subscription does not currently allow transaction changes. You can still view your workspace and review billing settings."
              : `Your workspace has ${usage} of ${max} stored transactions on ${tier}. New transactions are disabled; existing Pending transactions can still be updated.`}
          </p>
        </div>
      </div>

      {canManageBilling ? <>
        <Link
          href="/settings?tab=profile"
          className={`h-8 px-4 rounded-md text-xs font-semibold tracking-wide inline-flex items-center gap-1.5 transition-colors whitespace-nowrap self-end sm:self-center ${
            reason === "subscription_restricted"
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-amber-500 hover:bg-amber-600 text-zinc-950"
          }`}
        >
          Review Billing Settings
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </> : <p className="text-xs text-zinc-400">Contact your workspace administrator to manage billing.</p>}
    </div>
  );
}
