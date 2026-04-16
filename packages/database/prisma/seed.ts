import { prisma } from "../index";
import bcrypt from "bcryptjs";

async function main() {
  const hashedPassword = await bcrypt.hash("admin123", 10);

  // 1. Create a Role
  const adminRole = await prisma.role.upsert({
    where: { name: "SuperAdmin" },
    update: {},
    create: {
      name: "SuperAdmin",
      permissions: ["all"],
    },
  });

  // 2. Create a Tenant (Company)
  const tenant = await prisma.tenant.create({
    data: {
      name: "Sensei Corp",
      subscriptionStatus: "active",
    },
  });

  // 3. Create a User
  await prisma.user.create({
    data: {
      email: "admin@sensei.com",
      passwordHash: hashedPassword,
      tenantId: tenant.id,
      roleId: adminRole.id,
    },
  });

  console.log("✅ Seed completed: admin@sensei.com / admin123");
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
