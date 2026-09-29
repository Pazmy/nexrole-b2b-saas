import "dotenv/config";
import { test, expect as baseExpect } from "@playwright/test";
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const expect = baseExpect.configure({ timeout: 20_000 });
// Run against a server with STRIPE_SECRET_KEY=disabled-for-ui-test. No remote Stripe calls.
test("billing preserves profile design, lifecycle policy, recovery access and role boundaries", async ({ browser }) => {
  test.skip(process.env.E2E_BILLING_UI_DISABLED !== "true", "Requires a local server with STRIPE_SECRET_KEY=disabled-for-ui-test; explicitly opt in.");
  test.setTimeout(180_000);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const tenant = randomUUID(), name = "Billing UI test " + tenant;
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [admin, member] = await Promise.all(contexts.map(context => context.newPage()));
  try {
    await db.query('INSERT INTO tenants (id,name,"updatedAt") VALUES ($1,$2,NOW())', [tenant, name]);
    const hash = await bcrypt.hash("BillingTest123!", 4);
    for (const [index, role] of ["SuperAdmin", "Member"].entries()) {
      const email = randomUUID() + "@example.test";
      await db.query('INSERT INTO roles (name,permissions,"updatedAt") VALUES ($1,$2,NOW()) ON CONFLICT (name) DO NOTHING', [role, "[]"]);
      await db.query('INSERT INTO users (id,email,"passwordHash","tenantId","roleId","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,$4,(SELECT id FROM roles WHERE name=$5),NOW(),NOW())', [randomUUID(), email, hash, tenant, role]);
      const page = index === 0 ? admin : member;
      await page.goto("/login");
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill("BillingTest123!");
      await page.getByRole("button", { name: "Sign In", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Dashboard Overview" })).toBeVisible();
      await page.goto("/settings?tab=profile&billing_success=true");
      await expect(page.getByLabel("Company Legal Name")).toHaveValue(name);
      await expect(page.getByText("Payment is not confirmed by this URL.", { exact: false })).toBeVisible();
    }
    const panel = admin.getByRole("region", { name: "Workspace billing" });
    await expect(panel.getByText("FREE", { exact: true })).toBeVisible();
    await expect(member.getByRole("button", { name: "Upgrade Workspace Account" })).toHaveCount(0);
    await expect(member.getByRole("button", { name: "Check billing status" })).toHaveCount(0);
    await expect(member.getByLabel("Company Legal Name")).toBeDisabled();
    for (const action of ["Upgrade Workspace Account", "Check billing status"]) {
      await panel.getByRole("button", { name: action }).click();
      await expect(panel.getByRole("alert")).toContainText("Billing configuration is unavailable.");
      await expect(panel.getByRole("button", { name: action })).toBeEnabled();
    }
    const operation = randomUUID();
    await db.query('INSERT INTO external_operations (id,"tenantId",kind,"idempotencyKey","parameterFingerprint",state,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW())', [operation, tenant, "checkout_create", operation, "a".repeat(64), "pending"]);
    await admin.reload();
    await expect(panel.getByRole("button", { name: "Continue checkout" })).toBeVisible();
    await expect(panel.getByText("A checkout request is pending.", { exact: false })).toBeVisible();
    await db.query('DELETE FROM external_operations WHERE id=$1 AND "tenantId"=$2', [operation, tenant]);
    await db.query('INSERT INTO transactions (id,amount,description,"tenantId","userId","updatedAt") SELECT gen_random_uuid(),1,$2,$1,(SELECT id FROM users WHERE "tenantId"=$1 LIMIT 1),NOW() FROM generate_series(1,10)', [tenant, "Billing quota fixture"]);
    await admin.reload();
    await expect(panel.getByText("10 of 10 stored transactions.", { exact: false })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Usage Threshold Reached" })).toBeVisible();
    await admin.getByRole("button", { name: "Save Structural Profile" }).click();
    await expect(admin.getByText("Organization profile updated successfully!", { exact: true })).toBeVisible();
    for (const status of ["active", "trialing", "past_due", "unpaid", "paused", "incomplete", "incomplete_expired", "canceled"]) {
      await db.query('UPDATE tenants SET "subscriptionStatus"=$2,"stripeCustomerId"=$3,"stripeSubscriptionId"=$4,"billingSyncStatus"=$5,"subscriptionCancelAtPeriodEnd"=$6 WHERE id=$1', [tenant, status, "cus_Ui" + tenant.replaceAll("-", ""), "sub_Ui" + tenant.replaceAll("-", ""), "synced", status === "active"]);
      await admin.goto("/settings?tab=profile");
      await expect(panel.getByText(status.replaceAll("_", " ").toUpperCase(), { exact: true })).toBeVisible();
      await expect(panel.getByRole("button", { name: "Manage billing" })).toBeVisible();
      const restricted = !["active", "trialing", "canceled"].includes(status);
      await expect(admin.getByRole("heading", { name: "Transaction Writes Restricted" })).toHaveCount(restricted ? 1 : 0);
      await expect(panel.getByRole("button", { name: "Upgrade Workspace Account" })).toHaveCount(["canceled", "incomplete_expired"].includes(status) ? 1 : 0);
      if (status === "active") await expect(panel.getByText("Cancellation scheduled", { exact: false })).toBeVisible();
    }
    await panel.getByRole("button", { name: "Manage billing" }).click();
    await expect(panel.getByRole("alert")).toContainText("Billing configuration is unavailable.");
    await db.query('UPDATE tenants SET "subscriptionStatus"=$2,"billingSyncStatus"=$3 WHERE id=$1', [tenant, "past_due", "conflict"]);
    await admin.reload();
    await expect(panel.getByText("Billing requires review.", { exact: false })).toBeVisible();
    await admin.getByRole("link", { name: "Change password" }).click();
    await expect(admin).toHaveURL(/\/settings\/security/);
    await admin.goto("/settings?tab=team");
    await expect(admin.getByRole("heading", { name: "Membership Log", exact: true })).toBeVisible();
    await member.goto("/settings?tab=profile");
    await expect(member.getByRole("region", { name: "Workspace billing" }).getByText("PAST DUE", { exact: true })).toBeVisible();
    await expect(member.getByRole("button", { name: "Manage billing" })).toHaveCount(0);
    await expect(member.getByRole("heading", { name: "Transaction Writes Restricted" })).toBeVisible();
    await admin.goto("/settings?tab=profile");
    await expect(panel.getByText("PAST DUE", { exact: true })).toBeVisible();
    await admin.evaluate(() => document.fonts.ready);
    await admin.screenshot({ path: "test-results/billing-admin.png", fullPage: true });
    await member.screenshot({ path: "test-results/billing-member.png", fullPage: true });
    expect((await db.query('SELECT "subscriptionStatus" FROM tenants WHERE id=$1', [tenant])).rows[0].subscriptionStatus).toBe("past_due");
  } finally {
    for (const context of contexts) await context.close();
    await db.query('DELETE FROM tenants WHERE id=$1 AND name=$2', [tenant, name]);
    await db.end();
  }
});
