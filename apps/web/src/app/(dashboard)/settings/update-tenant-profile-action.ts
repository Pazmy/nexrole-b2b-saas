"use server";

import { AccessDeniedError, requirePermission } from "@/lib/authorization";
import { prisma } from "@nexrole/database";
import { revalidatePath } from "next/cache";
import { writeAuditLog } from "@/lib/audit";

export interface ProfileFormState {
  error?: string | null;
  success?: string | null;
}

export async function updateTenantProfile(
  prevState: ProfileFormState | null,
  formData: FormData,
) {
  let tenantId: string;
  try {
    ({ tenantId } = await requirePermission("workspace:update"));
  } catch (error) {
    if (error instanceof AccessDeniedError) return { error: error.message };
    throw error;
  }

  const name = (formData.get("name") || formData.get("companyName")) as string;

  if (!name || name.trim().length < 2) {
    return { error: "Organization name must be at least 2 characters long." };
  }

  try {
    const oldTenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { name: name.trim() },
    });

    await writeAuditLog("TENANT_PROFILE_UPDATED", {
      before: oldTenant?.name || "",
      after: name.trim(),
    });

    revalidatePath("/settings");
    return {
      success: "Organization profile updated successfully!",
      error: null,
    };
  } catch (error) {
    console.error("Settings Mutation Failure:", error);
    return {
      error: "An unexpected internal database error occurred.",
      success: null,
    };
  }
}
