import { prisma } from "../index";
import bcrypt from "bcryptjs";

async function main() {
  console.log("🌱 Starting enterprise database seeding...");

  const hashedPassword = await bcrypt.hash("admin123", 10);

  // 1. Idempotent Role Creation (using upsert)
  const adminRole = await prisma.role.upsert({
    where: { name: "SuperAdmin" },
    update: {},
    create: {
      name: "SuperAdmin",
      permissions: ["all"],
    },
  });

  // 2. Idempotent Tenant Creation
  let tenant = await prisma.tenant.findFirst({
    where: { name: "Sensei Corp" },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: "Sensei Corp",
        subscriptionStatus: "active",
      },
    });
  }

  // 3. Idempotent User Creation (using upsert on unique email)
  const user = await prisma.user.upsert({
    where: { email: "admin@sensei.com" },
    update: {
      roleId: adminRole.id,
      tenantId: tenant.id,
    },
    create: {
      email: "admin@sensei.com",
      passwordHash: hashedPassword,
      tenantId: tenant.id,
      roleId: adminRole.id,
    },
  });

  // 4. Clean up previous transaction logs for this tenant
  // Why: Prevents infinite data growth if you run the seed command multiple times
  await prisma.transaction.deleteMany({
    where: { tenantId: tenant.id },
  });

  // 5. Generate Real-World Metric Distribution Data
  const mockTransactions = [
    {
      amount: 1250.0,
      status: "completed",
      description: "Enterprise SaaS Monthly Subscription - Premium Tier",
    },
    {
      amount: 450.75,
      status: "completed",
      description: "Cloud Infrastructure Compute Overage Metering",
    },
    {
      amount: 3200.0,
      status: "completed",
      description: "B2B Custom Integration Advisory Services",
    },
    {
      amount: 99.0,
      status: "completed",
      description: "24/7 Dedicated Support SLA Add-on",
    },
    {
      amount: 1500.0,
      status: "pending",
      description: "Platform API Setup Fee - Milestone Payment",
    },
    {
      amount: 250.0,
      status: "pending",
      description: "Seat License Expansion Pack (+5 Active Members)",
    },
    {
      amount: 120.0,
      status: "failed",
      description: "Automated Credit Card Clearing Retry System",
    },
    {
      amount: 5400.0,
      status: "completed",
      description: "Enterprise Core Infrastructure Annual Renewal Contract",
    },
    {
      amount: 1000.0,
      status: "pending",
      description: "Annual subscription renewal",
    },
    {
      amount: 2000.0,
      status: "completed",
      description: "Enterprise Core Infrastructure Annual Renewal Contract",
    },
    {
      amount: 9600.0,
      status: "completed",
      description: "Enterprise Core Infrastructure Annual Renewal Contract",
    },
    {
      amount: 120.0,
      status: "failed",
      description: "Automated Credit Card Clearing Retry System",
    },
    {
      amount: 3200.0,
      status: "completed",
      description: "B2B Custom Integration Advisory Services",
    },
    {
      amount: 4400.0,
      status: "pending",
      description: "Cloud Infrastructure Compute Overage Metering",
    },
    {
      amount: 120.0,
      status: "failed",
      description: "Automated Credit Card Clearing Retry System",
    },
  ];

  console.log(
    `💸 Injecting ${mockTransactions.length} transactions scoped to tenant: [${tenant.name}]...`,
  );

  // 6. Bulk Insert Loop
  for (const tx of mockTransactions) {
    await prisma.transaction.create({
      data: {
        amount: tx.amount,
        status: tx.status,
        description: tx.description,
        tenantId: tenant.id,
        userId: user.id,
      },
    });
  }

  console.log("✅ Seed pipeline completed successfully!");
  console.log("👉 Target Portal Account: admin@sensei.com / admin123");
}

main()
  .catch((e) => {
    console.error("❌ Database seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
