"use server";

import { prisma } from "@nexrole/database";
import bcryptjs from "bcryptjs";

export async function registerWorkSpace(
  prevState: unknown,
  formData: FormData,
) {
  const companyName = formData.get("name") as string;
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  // 1. Validation Constraints
  if (!companyName || companyName.trim().length < 2) {
    return { error: "Company name must be at least 2 characters long." };
  }
  if (!email || !email.includes("@")) {
    return { error: "Please enter a valid email address." };
  }
  if (!password || password.length < 6) {
    return { error: "Password must be at least 6 characters long." };
  }

  try {
    // 2. Check for existing unique user accounts globally
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return { error: "An account with this email address already exists." };
    }

    const hashedPassword = await bcryptjs.hash(password, 10);

    // 3. Atomic Database Transaction: Roll back everything if any query fails
    await prisma.$transaction(async (tx) => {
      // Find or create the standard SuperAdmin security role profile
      let adminRole = await tx.role.findFirst({
        where: { name: "SuperAdmin" },
      });
      if (!adminRole) {
        adminRole = await tx.role.create({
          data: { name: "SuperAdmin", permissions: ["all"] },
        });
      }

      // Create the isolated Tenant company container
      const newTenant = await tx.tenant.create({
        data: {
          name: companyName.trim(),
          subscriptionStatus: "active", // Default onboarding state
        },
      });

      // Create the founding administrator user profile
      const newUser = await tx.user.create({
        data: {
          email: email.trim().toLowerCase(),
          passwordHash: hashedPassword,
          tenantId: newTenant.id,
          roleId: adminRole.id,
        },
      });

      return { tenant: newTenant, user: newUser };
    });

    return { success: true, error: null };
  } catch (error) {
    console.error("Workspace Onboarding Transaction Failure:", error);
    return {
      error: "An unexpected internal system database exception occurred.",
    };
  }
}
