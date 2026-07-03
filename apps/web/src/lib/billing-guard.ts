import { prisma } from "@nexrole/database";
import { SUBSCRIPTION_STATUS } from "@/lib/constants";

export interface BillingStatusSummary {
  isLocked: boolean;
  reason: "past_due" | "usage_limit_exceeded" | "none";
  currentUsage: number;
  maxUsage: number;
  tier: string;
}

export async function checkTenantBillingStatus(
  tenantId: string,
): Promise<BillingStatusSummary> {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!tenantId || !uuidRegex.test(tenantId)) {
    console.warn(
      `[BillingGuard] Aborted lookup: tenantId "${tenantId}" is not a valid UUID.`,
    );
    return {
      isLocked: true,
      reason: "past_due",
      currentUsage: 0,
      maxUsage: 0,
      tier: "Free Tier",
    };
  }

  let tenant;
  try {
    tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });
  } catch (err) {
    if (err instanceof Error) {
      console.error("[BillingGuard] Prisma query failed with details:", {
        message: err.message,
        code: "code" in err ? (err as Record<string, unknown>).code : undefined,
        meta: "meta" in err ? (err as Record<string, unknown>).meta : undefined,
        stack: err.stack,
      });
    } else {
      console.error("[BillingGuard] Prisma query failed with details:", {
        message: String(err),
      });
    }
    throw err;
  }

  if (!tenant) {
    return {
      isLocked: true,
      reason: "past_due",
      currentUsage: 0,
      maxUsage: 0,
      tier: "Free Tier",
    };
  }

  // 1. Hard Gate: Block access immediately if the subscription is delinquent
  if (
    tenant.subscriptionStatus === SUBSCRIPTION_STATUS.PAST_DUE ||
    tenant.subscriptionStatus === SUBSCRIPTION_STATUS.UNPAID
  ) {
    return {
      isLocked: true,
      reason: "past_due",
      currentUsage: 0,
      maxUsage: 0,
      tier: "Pro Tier",
    };
  }

  // 2. Read Usage metrics: Calculate operational transaction volume counts
  const currentTransactionCount = await prisma.transaction.count({
    where: { tenantId },
  });

  const status = tenant.subscriptionStatus;

  const isFreeAccount =
    status === SUBSCRIPTION_STATUS.FREE ||
    status === SUBSCRIPTION_STATUS.CANCELED;

  // 3. Soft Gate: Enforce specific limits on the Free tier
  if (isFreeAccount && currentTransactionCount >= 10) {
    return {
      isLocked: true,
      reason: "usage_limit_exceeded",
      currentUsage: currentTransactionCount,
      maxUsage: 10,
      tier: "Free Tier",
    };
  }

  return {
    isLocked: false,
    reason: "none",
    currentUsage: currentTransactionCount,
    maxUsage: isFreeAccount ? 10 : Infinity,
    tier: isFreeAccount ? "Free Tier" : "Pro Tier",
  };
}
