"use server";

import { auth } from "@/auth";
import { prisma } from "@nexrole/database";
import crypto from "crypto";
import { revalidatePath } from "next/cache";

// 1. Generate a brand new token profile securely
export async function generateApiKey(name: string) {
  const session = await auth();
  const tenantId = (session?.user as any)?.tenantId;
  const userRole = (session?.user as any)?.role;

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

  await prisma.apiKey.create({
    data: {
      name: name.trim(),
      key: secureDbHash,
      tenantId: tenantId,
    },
  });

  revalidatePath("/settings");

  // Return the raw readable key token string exactly once to the client view layout
  return publicRawApiKey;
}

// 2. Revoke an existing API key
export async function revokeApiKey(keyId: string) {
  const session = await auth();
  const tenantId = (session?.user as any)?.tenantId;
  const userRole = (session?.user as any)?.role;

  if (!tenantId || userRole !== "SuperAdmin") {
    throw new Error("Unauthorized access.");
  }

  await prisma.apiKey.delete({
    where: {
      id: keyId,
      tenantId: tenantId, // Strict multi-tenant deletion boundary check
    },
  });

  revalidatePath("/settings");
}
