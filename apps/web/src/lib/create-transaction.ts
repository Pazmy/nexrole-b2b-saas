import "server-only";
import { prisma } from "@nexrole/database";
import { AccessDeniedError, requirePermission } from "./authorization";
import { hasPermission } from "./permissions";
import { createTransactionSchema, INITIAL_TRANSACTION_STATUS } from "./transaction-rules";
import { getTransactionWriteDecision } from "./transaction-entitlements";

export class TransactionCreationError extends Error {
  constructor(public readonly code: "creation_limit_reached" | "subscription_restricted") {
    super(code === "creation_limit_reached"
      ? "Your workspace has reached the Free limit of 10 stored transactions. Upgrade to create more."
      : "Your workspace subscription does not currently allow transaction changes. Contact your workspace administrator.");
    this.name = "TransactionCreationError";
  }
}

export async function createTransaction(input: unknown): Promise<{ id: string }> {
  // Authentication is part of the service boundary, not an argument supplied by a caller.
  const actor = await requirePermission("transactions:create");
  const values = createTransactionSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    // Every creation for a workspace must take this lock before counting or writing.
    // READ COMMITTED makes the count see any preceding creator's committed row.
    // Locking the tenant also serializes subscription changes with this decision.
    const tenants = await tx.$queryRaw<{ subscriptionStatus: string }[]>`
      SELECT "subscriptionStatus" FROM tenants
      WHERE id = ${actor.tenantId}::uuid FOR UPDATE`;
    if (!tenants[0]) throw new AccessDeniedError();

    // Recheck membership/session after waiting for the tenant lock. Hold shared locks
    // until commit so deactivation, role changes, and password resets cannot race this write.
    const members = await tx.$queryRaw<{ role: string }[]>`
      SELECT r.name AS role FROM users u JOIN roles r ON r.id = u."roleId"
      WHERE u.id = ${actor.id}::uuid AND u."tenantId" = ${actor.tenantId}::uuid
        AND u."isActive" = true AND u."emailVerifiedAt" IS NOT NULL
        AND u."sessionVersion" = ${actor.sessionVersion}
      FOR SHARE OF u, r`;
    if (!members[0] || !hasPermission(members[0].role, "transactions:create")) throw new AccessDeniedError();

    const storedCount = await tx.transaction.count({ where: { tenantId: actor.tenantId } });
    const decision = getTransactionWriteDecision(tenants[0].subscriptionStatus, { operation: "create", storedCount });
    if (!decision.allowed) {
      if (decision.reason === "creation_limit_reached" || decision.reason === "subscription_restricted") {
        throw new TransactionCreationError(decision.reason);
      }
      throw new Error("Invalid transaction creation policy state.");
    }

    return tx.transaction.create({
      data: {
        description: values.description,
        amount: values.amount,
        status: INITIAL_TRANSACTION_STATUS,
        tenantId: actor.tenantId,
        userId: actor.id,
      },
      select: { id: true },
    });
  }, { isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 10_000 });
}
