"use server";

import { auth } from "@/auth";
import { prisma } from "@nexrole/database";
import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { writeAuditLog } from "@/lib/audit";

// 1. Generate a brand new token profile securely
export async function generateApiKey(name: string) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userRole = session?.user?.role;

  if (!tenantId || userRole !== "SuperAdmin") {
    throw new Error("Unauthorized access. SuperAdmin privileges required.");
  }

  if (!name || name.trim().length < 2) {
    throw new Error("API Key label must be at least 2 characters long.");
  }

  // Generate a distinct, cryptographically secure key string
  const rawTokenBytes = crypto.randomBytes(24).toString("hex");
  const publicRawApiKey = `nr_live_${rawTokenBytes}`;

  // Execute a SHA-256 hash to generate the matching unique signature for DB storage
  const secureDbHash = crypto
    .createHash("sha256")
    .update(publicRawApiKey)
    .digest("hex");

  const newKey = await prisma.apiKey.create({
    data: {
      name: name.trim(),
      key: secureDbHash,
      tenantId: tenantId,
    },
  });

  await writeAuditLog("DEVELOPER_API_KEY_GENERATED", {
    keyId: newKey.id,
    keyName: name.trim(),
  });

  revalidatePath("/settings");

  // Return the raw readable key token string exactly once to the client view layout
  return publicRawApiKey;
}

// 2. Revoke an existing API key
export async function revokeApiKey(keyId: string) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userRole = session?.user?.role;

  if (!tenantId || userRole !== "SuperAdmin") {
    throw new Error("Unauthorized access.");
  }

  const keyRecord = await prisma.apiKey.findFirst({
    where: {
      id: keyId,
      tenantId: tenantId,
    },
  });

  if (keyRecord) {
    await prisma.apiKey.delete({
      where: {
        id: keyId,
      },
    });

    await writeAuditLog("DEVELOPER_API_KEY_REVOKED", {
      keyId: keyId,
      keyName: keyRecord.name,
    });
  }

  revalidatePath("/settings");
}
