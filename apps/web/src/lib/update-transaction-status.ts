import "server-only";
import { prisma } from "@nexrole/database";
import { AccessDeniedError, requirePermission } from "./authorization";
import { hasPermission } from "./permissions";
import { updateTransactionStatusSchema } from "./transaction-rules";
import { getTransactionWriteDecision } from "./transaction-entitlements";

export class TransactionStatusError extends Error {
  constructor(public readonly code: "not_found" | "status_conflict" | "subscription_restricted") {
    super(code === "not_found" ? "Transaction not found."
      : code === "status_conflict" ? "This transaction is no longer pending. Refresh to see its current status."
        : "Your workspace subscription does not currently allow transaction changes.");
    this.name = "TransactionStatusError";
  }
}

export async function updateTransactionStatus(input: unknown) {
  const actor = await requirePermission("transactions:update-status");
  const values = updateTransactionStatusSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    // Use the same lock order as creation; serialize billing changes and recheck
    // current membership after any wait, holding the decision through commit.
    const tenants = await tx.$queryRaw<{ subscriptionStatus: string }[]>`
      SELECT "subscriptionStatus" FROM tenants WHERE id = ${actor.tenantId}::uuid FOR UPDATE`;
    if (!tenants[0]) throw new AccessDeniedError();
    const members = await tx.$queryRaw<{ role: string }[]>`
      SELECT r.name AS role FROM users u JOIN roles r ON r.id = u."roleId"
      WHERE u.id = ${actor.id}::uuid AND u."tenantId" = ${actor.tenantId}::uuid
        AND u."isActive" = true AND u."emailVerifiedAt" IS NOT NULL
        AND u."sessionVersion" = ${actor.sessionVersion} FOR SHARE OF u, r`;
    if (!members[0] || !hasPermission(members[0].role, "transactions:update-status")) throw new AccessDeniedError();
    const where = { id: values.id, tenantId: actor.tenantId };
    if (!await tx.transaction.findFirst({ where, select: { id: true } })) throw new TransactionStatusError("not_found");
    if (!getTransactionWriteDecision(tenants[0].subscriptionStatus, { operation: "update-status" }).allowed) {
      throw new TransactionStatusError("subscription_restricted");
    }
    // Compare-and-set prevents a second writer from overwriting a terminal status.
    // No count check: reaching the Free creation limit must not block status updates.
    const result = await tx.transaction.updateMany({ where: { ...where, status: "pending" }, data: { status: values.status } });
    if (result.count !== 1) throw new TransactionStatusError("status_conflict");
    return { id: values.id, status: values.status };
  }, { isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 10_000 });
}
