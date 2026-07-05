import { auth } from "@/auth";
import { prisma } from "@nexrole/database";
import { headers } from "next/headers";

type PrismaJsonValue = string | number | boolean | null | Date | { [key: string]: PrismaJsonValue } | PrismaJsonValue[];

export async function writeAuditLog(action: string, metadata?: Record<string, PrismaJsonValue>) {
  try {
    const session = await auth();
    const tenantId = session?.user?.tenantId;
    const actorId = session?.user?.id;
    const actorEmail = session?.user?.email;

    if (!tenantId) {
      console.warn(`[writeAuditLog] Aborted logging action "${action}": Missing tenant session context.`);
      return null;
    }

    const headersList = await headers();
    const ipAddress = headersList.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";
    const userAgent = headersList.get("user-agent") || "Unknown";

    const logEntry = await prisma.auditLog.create({
      data: {
        action,
        actorId,
        actorEmail,
        tenantId,
        ipAddress,
        userAgent,
        metadata: metadata || {},
      },
    });

    return logEntry;
  } catch (error) {
    console.error("[writeAuditLog] Failed to write audit log:", error);
    return null;
  }
}
