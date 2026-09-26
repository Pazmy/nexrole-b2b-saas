import "server-only";
import { prisma } from "@nexrole/database";
import { z } from "zod";
import { getTransactionEntitlement, getTransactionWriteDecision } from "./transaction-entitlements";

export interface BillingStatusSummary {
  isLocked: boolean;
  reason: "subscription_restricted" | "usage_limit_exceeded" | "none";
  currentUsage: number;
  maxUsage: number | null;
  tier: string;
}

// Presentation summary only. Transaction services enforce fresh policy inside locks.
export async function checkTenantBillingStatus(tenantId: string): Promise<BillingStatusSummary> {
  const tenant = z.uuid().safeParse(tenantId).success
    ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { subscriptionStatus: true } }) : null;
  const entitlement = getTransactionEntitlement(tenant?.subscriptionStatus);
  const currentUsage = tenant ? await prisma.transaction.count({ where: { tenantId } }) : 0;
  const decision = getTransactionWriteDecision(tenant?.subscriptionStatus, { operation: "create", storedCount: currentUsage });
  return {
    isLocked: !decision.allowed,
    reason: decision.allowed ? "none" : decision.reason === "creation_limit_reached" ? "usage_limit_exceeded" : "subscription_restricted",
    currentUsage,
    maxUsage: entitlement.maxStoredTransactions,
    tier: entitlement.tier === "free" ? "Free Tier" : entitlement.tier === "pro" ? "Pro Tier" : "Restricted",
  };
}
