import "dotenv/config";
import { test, expect } from "@playwright/test";
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

test("tenant list and detail reads stay isolated between two verified workspaces", async ({ browser }) => {
  test.setTimeout(90_000);
  const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  const contexts = [await browser.newContext(), await browser.newContext()];
  const fixtures = [0, 1].map(() => ({ tenant: randomUUID(), user: randomUUID(), transaction: randomUUID(), email: randomUUID() + "@example.test" }));
  try {
    const hash = await bcrypt.hash("IsolationTest123!", 4);
    await database.query('INSERT INTO roles (name, permissions, "updatedAt") VALUES ($1, $2, NOW()) ON CONFLICT (name) DO NOTHING', ['SuperAdmin', '[]']);
    for (const fixture of fixtures) {
      await database.query('INSERT INTO tenants (id, name, "subscriptionStatus", "updatedAt") VALUES ($1, $2, $3, NOW())', [fixture.tenant, 'Isolation test ' + fixture.tenant, 'free']);
      await database.query('INSERT INTO users (id, email, "passwordHash", "tenantId", "roleId", "emailVerifiedAt", "updatedAt") VALUES ($1, $2, $3, $4, (SELECT id FROM roles WHERE name = $5), NOW(), NOW())', [fixture.user, fixture.email, hash, fixture.tenant, 'SuperAdmin']);
      await database.query('INSERT INTO transactions (id, description, amount, status, "tenantId", "userId", "updatedAt") VALUES ($1, $2, 7, $3, $4, $5, NOW())', [fixture.transaction, 'Private ' + fixture.tenant, 'pending', fixture.tenant, fixture.user]);
    }
    for (const [index, fixture] of fixtures.entries()) {
      const page = await contexts[index].newPage();
      const foreign = fixtures[1 - index];
      await page.goto('/login');
      await page.locator('input[type="email"]').fill(fixture.email);
      await page.locator('input[type="password"]').fill('IsolationTest123!');
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Dashboard Overview' })).toBeVisible({ timeout: 20_000 });
      await page.goto('/transactions');
      await expect(page.getByRole('link', { name: 'Private ' + fixture.tenant, exact: true })).toBeVisible();
      await expect(page.getByText('Private ' + foreign.tenant, { exact: true })).toHaveCount(0);
      await page.goto('/transactions/' + foreign.transaction);
      await expect(page.getByRole('heading', { name: 'Transaction not found' })).toBeVisible();
      await expect(page.getByText('Private ' + foreign.tenant, { exact: true })).toHaveCount(0);
      await page.goto('/transactions/' + fixture.transaction);
      await expect(page.getByRole('heading', { name: 'Transaction details' })).toBeVisible();
      await expect(page.getByText('Private ' + fixture.tenant, { exact: true })).toBeVisible();
    }
  } finally {
    for (const context of contexts) await context.close();
    for (const fixture of fixtures) {
      await database.query('DELETE FROM transactions WHERE "tenantId" = $1', [fixture.tenant]);
      await database.query('DELETE FROM tenants WHERE id = $1 AND name = $2', [fixture.tenant, 'Isolation test ' + fixture.tenant]);
    }
    await database.end();
  }
});
