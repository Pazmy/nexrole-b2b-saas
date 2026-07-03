"use server";

import { auth } from "@/auth";
import { prisma } from "@nexrole/database";
import { revalidatePath } from "next/cache";

export interface ProfileFormState {
  error?: string | null;
  success?: string | null;
}

export async function updateTenantProfile(
  prevState: ProfileFormState | null,
  formData: FormData,
) {
  const session = await auth();

  const tenantId = session?.user?.tenantId;
  const userRole = session?.user?.role;

  if (!tenantId || !userRole || userRole !== "SuperAdmin") {
    return {
      error:
        "Unauthorized. Only SuperAdmins can modify organization parameters.",
    };
  }

  const name = (formData.get("name") || formData.get("companyName")) as string;

  if (!name || name.trim().length < 2) {
    return { error: "Organization name must be at least 2 characters long." };
  }

  try {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { name: name.trim() },
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
