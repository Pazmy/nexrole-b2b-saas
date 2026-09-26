export const FREE_TRANSACTION_LIMIT = 10;

export type TransactionEntitlement =
  | { tier: "free"; canWrite: true; maxStoredTransactions: number }
  | { tier: "pro"; canWrite: true; maxStoredTransactions: null }
  | { tier: "restricted"; canWrite: false; maxStoredTransactions: null };

// Application policy for the MVP, not a rewrite of Stripe's subscription lifecycle.
// Canceled subscriptions fall back to Free; only explicitly eligible states get Pro.
export function getTransactionEntitlement(subscriptionStatus: unknown): TransactionEntitlement {
  switch (subscriptionStatus) {
    case "free":
    case "canceled":
      return { tier: "free", canWrite: true, maxStoredTransactions: FREE_TRANSACTION_LIMIT };
    case "active":
    case "trialing":
      return { tier: "pro", canWrite: true, maxStoredTransactions: null };
    default:
      // Includes past_due, unpaid, incomplete, incomplete_expired, paused and unknown values.
      return { tier: "restricted", canWrite: false, maxStoredTransactions: null };
  }
}

type WriteRequest =
  | { operation: "create"; storedCount: number }
  | { operation: "update-status" };
export type TransactionWriteDecision =
  | { allowed: true; reason: "none" }
  | { allowed: false; reason: "subscription_restricted" | "creation_limit_reached" | "invalid_usage" | "invalid_operation" };

// Evaluate using fresh database state INSIDE the future write transaction/tenant lock.
// This pure policy does not itself enforce concurrency, authentication, or tenant scope.
export function getTransactionWriteDecision(subscriptionStatus: unknown, request: WriteRequest): TransactionWriteDecision {
  const entitlement = getTransactionEntitlement(subscriptionStatus);
  if (!entitlement.canWrite) return { allowed: false, reason: "subscription_restricted" };
  if (request.operation === "update-status") return { allowed: true, reason: "none" };
  if (request.operation !== "create") return { allowed: false, reason: "invalid_operation" };
  if (!Number.isSafeInteger(request.storedCount) || request.storedCount < 0) {
    return { allowed: false, reason: "invalid_usage" };
  }
  if (entitlement.maxStoredTransactions !== null && request.storedCount >= entitlement.maxStoredTransactions) {
    return { allowed: false, reason: "creation_limit_reached" };
  }
  return { allowed: true, reason: "none" };
}
