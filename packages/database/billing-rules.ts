// Pure contracts for 8.5. Services must supply reconciled, tenant-owned state.
// Not wired into checkout/webhooks until the persistence/backend checkpoints.
export const BILLING_SUBSCRIPTION_STATUSES = [
  "free", "active", "trialing", "incomplete", "incomplete_expired", "past_due", "unpaid", "paused", "canceled",
] as const;

export type CheckoutDecision = "create" | "resume" | "portal" | "reconcile";
export function getCheckoutDecision(input: {
  status: unknown; hasSubscription: boolean; attempt: "none" | "open" | "uncertain";
}): CheckoutDecision {
  if (typeof input.status !== "string" || !BILLING_SUBSCRIPTION_STATUSES.some((status) => status === input.status) ||
    typeof input.hasSubscription !== "boolean" || !["none", "open", "uncertain"].includes(input.attempt)) return "reconcile";
  const terminal = input.status === "canceled" || input.status === "incomplete_expired";
  if (input.status === "free" && input.hasSubscription) return "reconcile";
  if (input.status !== "free" && !input.hasSubscription) return "reconcile";
  if (input.hasSubscription && !terminal) return "portal";
  if (input.attempt === "uncertain") return "reconcile";
  return input.attempt === "open" ? "resume" : "create";
}

// Extract references only: this does not authenticate a payload or establish ownership.
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function subscriptionId(value: unknown): string | null {
  const id = typeof value === "string" ? value : record(value)?.id;
  return typeof id === "string" && /^sub_[A-Za-z0-9]+$/.test(id) ? id : null;
}
export function getInvoiceSubscriptionId(invoice: unknown): string | null {
  const parent = record(record(invoice)?.parent);
  if (parent?.type !== "subscription_details") return null;
  return subscriptionId(record(parent.subscription_details)?.subscription);
}

export function matchesBillingOwnership(expected: { customerId: string; subscriptionId: string }, actual: {
  customerId: unknown; subscriptionId: unknown;
}): boolean {
  return /^cus_[A-Za-z0-9]+$/.test(expected.customerId) && /^sub_[A-Za-z0-9]+$/.test(expected.subscriptionId) &&
    expected.customerId === actual.customerId && expected.subscriptionId === actual.subscriptionId;
}
