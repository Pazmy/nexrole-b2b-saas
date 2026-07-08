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

  // 2. Idempotent Tenant 1 (Sensei Corp - Active)
  let tenant1 = await prisma.tenant.findFirst({
    where: { name: "Sensei Corp" },
  });

  if (!tenant1) {
    tenant1 = await prisma.tenant.create({
      data: {
        name: "Sensei Corp",
        subscriptionStatus: "active",
      },
    });
  }

  // 3. Idempotent Tenant 2 (Glowstone - Free)
  let tenant2 = await prisma.tenant.findFirst({
    where: { name: "Glowstone" },
  });

  if (!tenant2) {
    tenant2 = await prisma.tenant.create({
      data: {
        name: "Glowstone",
        subscriptionStatus: "free",
      },
    });
  }

  // 4. Idempotent User 1 (admin@sensei.com)
  const user1 = await prisma.user.upsert({
    where: { email: "admin@sensei.com" },
    update: {
      roleId: adminRole.id,
      tenantId: tenant1.id,
    },
    create: {
      email: "admin@sensei.com",
      passwordHash: hashedPassword,
      tenantId: tenant1.id,
      roleId: adminRole.id,
    },
  });

  // 5. Idempotent User 2 (admin@glowstone.io)
  const user2 = await prisma.user.upsert({
    where: { email: "admin@glowstone.io" },
    update: {
      roleId: adminRole.id,
      tenantId: tenant2.id,
    },
    create: {
      email: "admin@glowstone.io",
      passwordHash: hashedPassword,
      tenantId: tenant2.id,
      roleId: adminRole.id,
    },
  });

  // 6. Clean up previous transaction logs for both tenants
  await prisma.transaction.deleteMany({
    where: {
      tenantId: {
        in: [tenant1.id, tenant2.id],
      },
    },
  });

  // 7. Mock Transactions for Tenant 1 (15 transactions)
  const senseiTransactions = [
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

  // 8. Mock Transactions for Tenant 2 (11 transactions)
  const glowstoneTransactions = [
    { amount: 50.0, status: "completed", description: "Starter Subscription" },
    { amount: 15.5, status: "completed", description: "Additional Seat License" },
    { amount: 99.99, status: "completed", description: "Professional Addon Package" },
    { amount: 200.0, status: "pending", description: "Custom Setup Consultation" },
    { amount: 10.0, status: "completed", description: "API Overage Bill" },
    { amount: 5.0, status: "failed", description: "SMS gateway test retry" },
    { amount: 45.0, status: "completed", description: "Support Tier Upgrade" },
    { amount: 120.0, status: "completed", description: "Monthly Professional Subscription" },
    { amount: 80.0, status: "pending", description: "Overage Billing Invoice" },
    { amount: 35.0, status: "completed", description: "Integration Setup Charge" },
    { amount: 15.0, status: "failed", description: "Failed payment retry attempt" },
  ];

  console.log(`💸 Injecting ${senseiTransactions.length} transactions scoped to [${tenant1.name}]...`);
  for (const tx of senseiTransactions) {
    await prisma.transaction.create({
      data: {
        amount: tx.amount,
        status: tx.status,
        description: tx.description,
        tenantId: tenant1.id,
        userId: user1.id,
      },
    });
  }

  console.log(`💸 Injecting ${glowstoneTransactions.length} transactions scoped to [${tenant2.name}]...`);
  for (const tx of glowstoneTransactions) {
    await prisma.transaction.create({
      data: {
        amount: tx.amount,
        status: tx.status,
        description: tx.description,
        tenantId: tenant2.id,
        userId: user2.id,
      },
    });
  }

  console.log("✅ Seed pipeline completed successfully!");
  console.log("👉 Accounts Generated:");
  console.log("   - admin@sensei.com / admin123 (Tenant: Sensei Corp - Active)");
  console.log("   - admin@glowstone.io / admin123 (Tenant: Glowstone - Free)");
}

main()
  .catch((e) => {
    console.error("❌ Database seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
