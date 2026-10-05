import { getTransactionEntitlement } from "./transaction-entitlements";

export type BillingView = {
  status: string; usage: number; hasCustomer: boolean; hasSubscription: boolean;
  syncStatus: string; pendingCheckout: boolean; cancelAtPeriodEnd: boolean; cancelAt: string | null;
};

const descriptions: Record<string, string> = {
  free: "Free workspace.", active: "Your Pro subscription is active.", trialing: "Your Pro trial is active.",
  canceled: "Your subscription ended. Free workspace limits apply.",
  past_due: "Payment is overdue. Review your payment method in the billing portal.",
  unpaid: "Payment remains unpaid. Recover your subscription in the billing portal.",
  paused: "Your subscription is paused. Review billing to resume it.",
  incomplete: "The initial payment is incomplete. Review billing to finish payment.",
  incomplete_expired: "The initial payment expired. Check billing status before starting another checkout.",
};

export function billingPresentation(view: BillingView) {
  const entitlement = getTransactionEntitlement(view.status);
  const limit = entitlement.maxStoredTransactions;
  const restricted = !entitlement.canWrite;
  const quotaReached = limit !== null && view.usage >= limit;
  const needsReview = view.syncStatus === "conflict" || (view.status !== "free" && !view.hasSubscription);
  return {
    label: Object.hasOwn(descriptions, view.status) ? view.status.replaceAll("_", " ").toUpperCase() : "UNKNOWN",
    description: Object.hasOwn(descriptions, view.status) ? descriptions[view.status] : "The subscription status is unrecognized. Contact your administrator.",
    restricted, quotaReached, needsReview,
    usage: limit === null ? `${view.usage} stored transactions${restricted ? "" : " · Unlimited Pro allowance"}.` : `${view.usage} of ${limit} stored transactions.`,
    policy: restricted ? "Transaction changes are restricted. Workspace reads, account recovery, membership management and billing recovery remain available."
      : quotaReached ? "New transactions are disabled; existing Pending transactions can still be updated." : "Transaction changes are available within your workspace allowance.",
    canCheckout: !needsReview && ["free", "canceled", "incomplete_expired"].includes(view.status),
  };
}
