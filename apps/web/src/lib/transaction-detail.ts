import "server-only";
import { prisma } from "@nexrole/database";
import { z } from "zod";
import { requirePermission } from "./authorization";

export async function getTransactionDetail(id: string) {
  const actor = await requirePermission("transactions:read");
  if (!z.uuid().safeParse(id).success) return null;
  const transaction = await prisma.transaction.findFirst({
    where: { id, tenantId: actor.tenantId },
    select: { id: true, description: true, amount: true, status: true, createdAt: true, updatedAt: true,
      tenant: { select: { subscriptionStatus: true } } },
  });
  return transaction ? { transaction, role: actor.role } : null;
}
