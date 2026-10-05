import "dotenv/config";
import { test, expect as baseExpect, type Page } from "@playwright/test";
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const expect = baseExpect.configure({ timeout: 20_000 });

test("transaction form preserves the ledger and handles validation, pending, quota, billing and read-only roles", async ({ browser }) => {
  test.setTimeout(180_000);
  const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  const tenantId = randomUUID();
  const adminId = randomUUID();
  const memberId = randomUUID();
  const email = `transaction-${tenantId}@example.test`;
  const memberEmail = `member-${tenantId}@example.test`;
  const password = "TransactionDemo123!";
  const context = await browser.newContext();
  const page = await context.newPage();
  const actionRequests: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") actionRequests.push(`POST ${new URL(request.url()).pathname}`); });
  page.on("response", (response) => { if (response.request().method() === "POST") actionRequests.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.on("requestfinished", (request) => { if (request.method() === "POST") actionRequests.push(`finished ${new URL(request.url()).pathname}`); });
  page.on("pageerror", (error) => actionRequests.push(`client error: ${error.name}: ${error.message.slice(0, 200)}`));
  const reader = await browser.newContext();
  const readerPage = await reader.newPage();

  async function login(target: Page, address: string) {
    await target.goto("/login");
    await target.locator('input[type="email"]').fill(address);
    await target.locator('input[type="password"]').fill(password);
    await target.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(target).toHaveURL(/\/$/);
  }
  async function countTransactions() {
    return (await database.query('SELECT count(*)::int AS count FROM transactions WHERE "tenantId" = $1', [tenantId])).rows[0].count;
  }
  try {
    for (const name of ["SuperAdmin", "Member"]) {
      await database.query('INSERT INTO roles (name, permissions, "updatedAt") VALUES ($1, $2, NOW()) ON CONFLICT (name) DO NOTHING', [name, '[]']);
    }
    await database.query('INSERT INTO tenants (id, name, "subscriptionStatus", "updatedAt") VALUES ($1, $2, $3, NOW())', [tenantId, `Transaction browser test ${tenantId}`, 'free']);
    const hash = await bcrypt.hash(password, 4);
    for (const [id, address, role] of [[adminId, email, "SuperAdmin"], [memberId, memberEmail, "Member"]]) {
      await database.query(`INSERT INTO users (id, email, "passwordHash", "tenantId", "roleId", "emailVerifiedAt", "updatedAt")
        VALUES ($1, $2, $3, $4, (SELECT id FROM roles WHERE name = $5), NOW(), NOW())`, [id, address, hash, tenantId, role]);
    }
    await login(page, email);
    await page.goto("/transactions?search=unmatched-filter");
    await expect(page.getByRole("heading", { name: "Ledger Operations" })).toBeVisible();
    await expect(page.getByText("0 / 10 stored transactions on Free.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New transaction", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByLabel("Amount (USD)")).toHaveCount(0);
    await page.getByRole("button", { name: "New transaction", exact: true }).click();
    await page.getByLabel("Description", { exact: true }).fill("Browser transaction");
    await page.getByLabel("Amount (USD)").fill("0");
    await page.getByRole("button", { name: "Create transaction", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("greater than zero");
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Browser transaction");
    expect(await countTransactions()).toBe(0);
    await page.getByLabel("Amount (USD)").fill("12.345");
    await page.getByRole("button", { name: "Create transaction", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("2 decimal places");
    await page.getByLabel("Amount (USD)").fill("12.50");
    await page.screenshot({ path: test.info().outputPath("transaction-form.png"), fullPage: true });

    // Hold a real DB lock so the pending UI can be inspected without a timing sleep.
    await database.query('BEGIN');
    await database.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    try {
      await page.getByRole("button", { name: "Create transaction", exact: true }).click();
      await expect(page.getByRole("button", { name: "Creating transaction...", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
      await expect(page.getByLabel("Amount (USD)")).toBeDisabled();
    } finally { await database.query('COMMIT'); }
    await expect(page.getByRole("status").filter({ hasText: "Transaction created." })).toBeVisible();
    await expect(page.getByText("1 / 10 stored transactions on Free.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/search=unmatched-filter/);
    await page.getByRole("link", { name: "View latest transactions" }).click();
    await expect(page.getByRole("row").filter({ hasText: "Browser transaction" })).toContainText("$12.50");
    await expect(page.getByRole("textbox", { name: "Search by description", exact: true })).toHaveValue("");
    await expect(page.getByRole("row").filter({ hasText: "Browser transaction" })).toContainText("pending");
    expect(await countTransactions()).toBe(1);

    await page.getByRole("button", { name: "Create another transaction", exact: true }).click();
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue("");
    await page.getByLabel("Description", { exact: true }).fill("Stale quota attempt");
    await page.getByLabel("Amount (USD)").fill("5");
    // Simulate another admin filling the quota after this form has been opened.
    // Keep fixtures older than UI-created rows, independent of the SQL session timezone.
    await database.query(`INSERT INTO transactions (description, amount, status, "tenantId", "userId", "createdAt", "updatedAt")
      SELECT 'Quota fixture', 1, 'pending', $1, $2, TIMESTAMP '2000-01-01 00:00:00', NOW() FROM generate_series(1, 9)`, [tenantId, adminId]);
    await page.getByRole("button", { name: "Create transaction", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("Free limit of 10");
    await expect(page.getByText("10 / 10 stored transactions on Free. Upgrade to create more.", { exact: true })).toBeVisible();
    expect(await countTransactions()).toBe(10);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "New transaction", exact: true })).toBeDisabled();

    await database.query('UPDATE tenants SET "subscriptionStatus" = $1 WHERE id = $2', ['paused', tenantId]);
    await page.reload();
    await expect(page.getByText("Your subscription does not currently allow new transactions. Review your billing settings.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Transaction Writes Restricted" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New transaction", exact: true })).toBeDisabled();
    await database.query('UPDATE tenants SET "subscriptionStatus" = $1 WHERE id = $2', ['active', tenantId]);
    await page.reload();
    await page.getByRole("button", { name: "New transaction", exact: true }).click();
    await page.getByLabel("Description", { exact: true }).fill("Pro transaction");
    await page.getByLabel("Amount (USD)").fill("25");
    await page.getByRole("button", { name: "Create transaction", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Transaction created." })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Pro transaction" })).toBeVisible();
    expect(await countTransactions()).toBe(11);

    await login(readerPage, memberEmail);
    await readerPage.goto("/transactions");
    await expect(readerPage.getByRole("row").filter({ hasText: "Pro transaction" })).toBeVisible();
    await expect(readerPage.getByRole("button", { name: "New transaction", exact: true })).toHaveCount(0);

    // Detail/status journey: read-only roles, Free quota, stale tabs and terminal states.
    await readerPage.getByRole("link", { name: "Pro transaction", exact: true }).click();
    await expect(readerPage.getByRole("heading", { name: "Transaction details" })).toBeVisible();
    await expect(readerPage.getByText("Your role has read-only access to transactions.")).toBeVisible();
    await expect(readerPage.getByRole("button", { name: "Save status", exact: true })).toHaveCount(0);
    await database.query('UPDATE tenants SET "subscriptionStatus" = $1 WHERE id = $2', ['free', tenantId]);
    await page.getByRole("link", { name: "Pro transaction", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save status", exact: true })).toBeEnabled();
    const stale = await context.newPage();
    await stale.goto(page.url());
    await stale.getByLabel("New status", { exact: true }).selectOption("failed");
    await page.screenshot({ path: test.info().outputPath("transaction-detail.png"), fullPage: true });
    await database.query('BEGIN');
    await database.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    try {
      await page.getByRole("button", { name: "Save status", exact: true }).click();
      await expect(page.getByRole("button", { name: "Saving status...", exact: true })).toBeDisabled();
      await expect(page.getByLabel("New status", { exact: true })).toBeDisabled();
    } finally { await database.query('COMMIT'); }
    await expect(page.getByRole("status")).toContainText("Transaction marked completed.");
    await expect(page.getByText("This status is final and cannot be changed.")).toBeVisible();
    await stale.getByRole("button", { name: "Save status", exact: true }).click();
    await expect(stale.getByRole("alert").filter({ hasText: "no longer pending" })).toBeVisible();
    await expect(stale.getByRole("button", { name: "Save status", exact: true })).toHaveCount(0);
    await stale.close();
    await page.getByRole("link", { name: "Back to transactions" }).click();
    await expect(page.getByRole("row").filter({ hasText: "Pro transaction" })).toContainText("completed");
    await page.getByRole("link", { name: "Browser transaction", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Transaction details" })).toBeVisible();
    await expect(page.locator("dd").filter({ hasText: "Browser transaction" })).toBeVisible();
    await database.query('UPDATE tenants SET "subscriptionStatus" = $1 WHERE id = $2', ['paused', tenantId]);
    await page.reload();
    await expect(page.getByText("Your subscription does not allow status changes.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save status", exact: true })).toHaveCount(0);
    await database.query('UPDATE tenants SET "subscriptionStatus" = $1 WHERE id = $2', ['free', tenantId]);
    await page.reload();
    await page.getByLabel("New status", { exact: true }).selectOption("failed");
    await page.getByRole("button", { name: "Save status", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Transaction marked failed.");
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dashboard Overview" })).toBeVisible();
    await expect(page.getByText("$25.00", { exact: true })).toBeVisible();
    await expect(page.getByText("Total value of completed transactions", { exact: true })).toBeVisible();
    await expect(page.getByText("+12.2% from last month", { exact: true })).toHaveCount(0);
    await expect(page.getByText("11", { exact: true })).toBeVisible();
    await expect(page.getByText("9", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Usage Threshold Reached" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("transaction-dashboard.png"), fullPage: true });

    await page.goto("/transactions?search=Quota&status=pending&page=999999999");
    await expect(page.getByText(/Showing Page 2 of 2/)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search by description", exact: true })).toHaveValue("Quota");
    await expect(page.getByRole("combobox", { name: "Filter by status" })).toHaveValue("pending");
    await expect(page.getByRole("row")).toHaveCount(5);
    await expect(page.getByRole("link", { name: "Next", exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("link", { name: "Previous", exact: true }).click();
    await expect(page.getByText(/Showing Page 1 of 2/)).toBeVisible();
    await expect(page).toHaveURL((url) => url.searchParams.get("search") === "Quota" && url.searchParams.get("status") === "pending" && url.searchParams.get("page") === "1");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Search by description", exact: true })).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "Filter by status" })).toHaveValue("all");
    await page.goBack();
    await expect(page.getByRole("textbox", { name: "Search by description", exact: true })).toHaveValue("Quota");
    await page.goto("/transactions?page=-2&status=unknown&search=a&search=b");
    await expect(page.getByText(/Showing Page 1 of 3/)).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Filter by status" })).toHaveValue("all");
    await page.goto("/transactions?search=NoSuchRecord&status=failed");
    await expect(page.getByText("No matching ledger activities recorded. Clear filters to see all transactions.")).toBeVisible();
    await page.goto(`/transactions/${randomUUID()}`);
    await expect(page.getByRole("heading", { name: "Transaction not found" })).toBeVisible();
    await page.goto("/transactions/invalid-id");
    await expect(page.getByRole("heading", { name: "Transaction not found" })).toBeVisible();
  } catch (error) {
    console.error("Transaction browser diagnostics", { actionRequests, storedCount: await countTransactions() });
    await page.screenshot({ path: test.info().outputPath("failure.png"), fullPage: true });
    throw error;
  } finally {
    await context.close(); await reader.close();
    await database.query('ROLLBACK');
    await database.query('DELETE FROM transactions WHERE "tenantId" = $1', [tenantId]);
    await database.query('DELETE FROM tenants WHERE id = $1 AND name = $2', [tenantId, `Transaction browser test ${tenantId}`]);
    await database.end();
  }
});
