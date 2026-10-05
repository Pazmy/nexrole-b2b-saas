import "dotenv/config";
import { test, expect as baseExpect, type Page } from "@playwright/test";
import pg from "pg";
import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Allow first-request compilation when this suite runs against the development server.
const expect = baseExpect.configure({ timeout: 20_000 });

test("new workspace completes onboarding, transactions, recovery, invitation, role restrictions and deactivation", async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = randomUUID();
  const email = `owner-${suffix}@example.test`;
  const teammate = `member-${suffix}@example.test`;
  const company = `Account test ${suffix}`;
  const previews = path.resolve(".email-previews");
  const ownPreviewFiles = new Set<string>();
  const context = await browser.newContext();
  const second = await browser.newContext();
  const page = await context.newPage();
  const otherPage = await second.newPage();

  async function emailLink(recipient: string, route: string) {
    let found = "";
    await expect.poll(async () => {
      for (const filename of (await readdir(previews).catch(() => [])).sort().reverse()) {
        const content = await readFile(path.join(previews, filename), "utf8");
        if (!content.startsWith(`To: ${recipient}\n`)) continue;
        ownPreviewFiles.add(filename);
        const link = content.match(/https?:\/\/\S+/)?.[0];
        // Resolve preview paths on the configured local test server, including
        // production builds whose required public origin uses HTTPS.
        if (link && new URL(link).pathname === route) { const url = new URL(link); found = url.pathname + url.search; return true; }
      }
      return false;
    }).toBe(true);
    return found;
  }
  async function login(target: Page, address: string, password: string) {
    await target.goto("/login");
    await target.locator('input[type="email"]').fill(address);
    await target.locator('input[type="password"]').fill(password);
    await target.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(target).toHaveURL(/\/$/);
  }
  try {
    await page.goto("/register");
    await expect(page).toHaveURL(/\/register\/workspace$/);
    await page.locator('[name="name"]').fill(company);
    await page.locator('[name="email"]').fill(email);
    await page.locator('[name="password"]').fill("initial-password-123");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const verify = await emailLink(email, "/verify-email");
    await page.goto(verify);
    await page.getByRole("button", { name: "Verify email", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Your email is verified");
    await login(page, email.toUpperCase(), "initial-password-123");
    await login(otherPage, email, "initial-password-123");

    // Step 8.3 acceptance starts from an actual newly registered workspace.
    await page.goto("/transactions");
    await expect(page.getByText("No transactions yet. New transactions will appear here.")).toBeVisible();
    await page.getByRole("button", { name: "New transaction", exact: true }).click();
    await page.getByLabel("Description", { exact: true }).fill("First workspace transaction");
    await page.getByLabel("Amount (USD)").fill("19.95");
    await page.getByRole("button", { name: "Create transaction", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Transaction created." })).toBeVisible();
    await page.getByRole("link", { name: "First workspace transaction", exact: true }).click();
    await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
    const transactionPath = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "Save status", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Transaction marked completed.");
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByText("$19.95", { exact: true })).toBeVisible();

    await page.goto("/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Send reset email" }).click();
    await expect(page.getByRole("status")).toContainText("If this address is eligible");
    const reset = await emailLink(email, "/reset-password");
    await page.goto(reset);
    await page.getByLabel("New password", { exact: true }).fill("replacement-password-123");
    await page.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Your password has been reset");
    await otherPage.goto("/settings");
    await expect(otherPage).toHaveURL(/\/login$/);
    await page.goto(reset);
    await page.getByLabel("New password", { exact: true }).fill("another-password-123");
    await page.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("already used");

    await login(page, email, "replacement-password-123");
    await page.goto("/settings/security");
    await page.getByLabel("Current password", { exact: true }).fill("replacement-password-123");
    await page.getByLabel("New password", { exact: true }).fill("changed-password-123");
    await page.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Your password has changed");
    await login(page, email, "changed-password-123");

    await page.goto("/settings?tab=team");
    await page.getByRole("button", { name: "+ Invite Workspace Member", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByLabel("Invite a teammate")).toHaveCount(0);
    await page.getByRole("button", { name: "+ Invite Workspace Member", exact: true }).click();
    await page.getByLabel("Invite a teammate").fill(teammate);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("status")).toContainText("Invitation sent");
    await page.getByRole("button", { name: "Invite Another User", exact: true }).click();
    await expect(page.getByLabel("Invite a teammate")).toHaveValue("");
    const invite = await emailLink(teammate, "/register/invite");
    await otherPage.goto(invite);
    await otherPage.getByLabel("Account Password", { exact: true }).fill("teammate-password-123");
    await otherPage.getByRole("button", { name: "Complete Workspace Enrollment", exact: true }).click();
    await expect(otherPage.getByRole("status")).toContainText("You have joined");
    await login(otherPage, teammate, "teammate-password-123");
    await otherPage.goto(invite);
    await expect(otherPage.getByRole("heading", { name: "This invitation is no longer available" })).toBeVisible();
    await page.goto(verify);
    await page.getByRole("button", { name: "Verify email", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("already used");
    // Complete the same registered workspace's journey with the invited account.
    await otherPage.goto("/transactions");
    await expect(otherPage.getByRole("heading", { name: "Ledger Operations" })).toBeVisible();
    await expect(otherPage.getByRole("link", { name: "First workspace transaction", exact: true })).toBeVisible();
    await expect(otherPage.getByRole("button", { name: "New transaction", exact: true })).toHaveCount(0);
    await otherPage.goto(transactionPath);
    await expect(otherPage.getByText("First workspace transaction", { exact: true })).toBeVisible();
    await expect(otherPage.getByRole("button", { name: "Save status", exact: true })).toHaveCount(0);
    await otherPage.goto("/settings?tab=profile");
    await expect(otherPage.getByLabel("Company Legal Name")).toHaveValue(company);
    await expect(otherPage.getByLabel("Company Legal Name")).toBeDisabled();
    await expect(otherPage.getByRole("button", { name: "Manage billing", exact: true })).toHaveCount(0);
    await expect(otherPage.getByRole("button", { name: "Upgrade Workspace Account", exact: true })).toHaveCount(0);
    await otherPage.goto("/settings?tab=team");
    await expect(otherPage.getByRole("heading", { name: "Membership Log", exact: true })).toBeVisible();
    await expect(otherPage.getByRole("row").filter({ hasText: teammate }).getByText("Member", { exact: true })).toBeVisible();
    await expect(otherPage.getByRole("button", { name: "+ Invite Workspace Member", exact: true })).toHaveCount(0);
    await expect(otherPage.getByRole("combobox")).toHaveCount(0);
    await expect(otherPage.getByRole("button", { name: "Deactivate", exact: true })).toHaveCount(0);

    await page.goto("/settings?tab=team");
    const joinedRow = page.getByRole("row").filter({ hasText: teammate });
    await joinedRow.getByRole("button", { name: "Deactivate", exact: true }).click();
    await joinedRow.getByRole("button", { name: "Confirm deactivation", exact: true }).click();
    await expect(joinedRow.getByRole("status")).toHaveText("Member deactivated.");
    await expect(joinedRow.getByText("Inactive", { exact: true })).toBeVisible();
    // The member's already-open session must fail its next protected request.
    await otherPage.goto(transactionPath);
    await expect(otherPage).toHaveURL(/\/login/);
    await otherPage.locator('input[type="email"]').fill(teammate);
    await otherPage.locator('input[type="password"]').fill("teammate-password-123");
    await otherPage.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(otherPage.getByText("Unable to sign in. Check your email and password, verify your email, or wait 15 minutes if you have tried repeatedly.", { exact: true })).toBeVisible();
    await expect(otherPage).toHaveURL(/\/login/);
    await page.goto(transactionPath);
    await expect(page.getByText("First workspace transaction", { exact: true })).toBeVisible();

    // Assert authoritative state and actor attribution before fixture cleanup.
    const evidence = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await evidence.connect();
    try {
      const workspace = await evidence.query('SELECT id, "subscriptionStatus" FROM tenants WHERE name=$1 AND id=(SELECT "tenantId" FROM users WHERE email=$2)', [company, email]);
      expect(workspace.rows).toHaveLength(1);
      const tenantId = workspace.rows[0].id;
      expect(workspace.rows[0].subscriptionStatus).toBe("free");
      const members = await evidence.query('SELECT u.id,u.email,u."isActive",u."emailVerifiedAt",u."sessionVersion",r.name AS role FROM users u JOIN roles r ON r.id=u."roleId" WHERE u."tenantId"=$1', [tenantId]);
      expect(members.rows).toHaveLength(2);
      const owner = members.rows.find(member => member.email === email);
      const joined = members.rows.find(member => member.email === teammate);
      expect(owner).toMatchObject({ role: "SuperAdmin", isActive: true });
      expect(joined).toMatchObject({ role: "Member", isActive: false, sessionVersion: 1 });
      expect(owner.emailVerifiedAt).not.toBeNull();
      expect(joined.emailVerifiedAt).not.toBeNull();
      const transactions = await evidence.query('SELECT id,description,amount,status,"userId" FROM transactions WHERE "tenantId"=$1', [tenantId]);
      expect(transactions.rows).toHaveLength(1);
      const transaction = transactions.rows[0];
      expect(transaction).toMatchObject({ description: "First workspace transaction", amount: "19.95", status: "completed", userId: owner.id });
      expect(transactionPath).toBe(`/transactions/${transaction.id}`);
      expect((await evidence.query('SELECT id FROM invitations WHERE "tenantId"=$1', [tenantId])).rows).toHaveLength(0);
      const audits = (await evidence.query('SELECT action,"actorId","actorSource",metadata FROM audit_logs WHERE "tenantId"=$1', [tenantId])).rows;
      for (const [action, actorId, details] of [
        ["TRANSACTION_CREATED", owner.id, { targetId: transaction.id, amount: "19.95", status: "pending" }],
        ["TRANSACTION_STATUS_CHANGED", owner.id, { targetId: transaction.id, previousStatus: "pending", status: "completed" }],
        ["MEMBER_INVITED", owner.id, { role: "Member" }],
        ["INVITATION_ACCEPTED", joined.id, { memberId: joined.id, role: "Member" }],
        ["MEMBER_DEACTIVATED", owner.id, { targetId: joined.id, previousActive: true, active: false }],
      ] as const) {
        const matching = audits.filter(audit => audit.action === action);
        expect(matching, action).toHaveLength(1);
        expect(matching[0]).toMatchObject({ actorId, actorSource: "user", metadata: details });
      }
      expect(audits.find(audit => audit.action === "INVITATION_ACCEPTED").metadata.targetId)
        .toBe(audits.find(audit => audit.action === "MEMBER_INVITED").metadata.targetId);
    } finally { await evidence.end(); }

  } catch (error) {
    await page.screenshot({ path: test.info().outputPath("failure.png") });
    throw error;
  } finally {
    await context.close(); await second.close();
    // Delete only the workspace and previews created by this unique test run.
    const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await database.connect();
    try {
      const owners = await database.query('SELECT t.id FROM users u JOIN tenants t ON t.id = u."tenantId" WHERE u.email = $1 AND t.name = $2', [email, company]);
      if (owners.rows[0]) {
        await database.query('DELETE FROM transactions WHERE "tenantId" = $1', [owners.rows[0].id]);
        await database.query('DELETE FROM invitations WHERE "tenantId" = $1', [owners.rows[0].id]);
        await database.query('DELETE FROM tenants WHERE id = $1 AND name = $2', [owners.rows[0].id, company]);
      }
    } finally { await database.end(); }
    for (const filename of await readdir(previews).catch(() => [])) {
      const content = await readFile(path.join(previews, filename), "utf8");
      if (content.startsWith(`To: ${email}\n`) || content.startsWith(`To: ${teammate}\n`)) ownPreviewFiles.add(filename);
    }
    for (const filename of ownPreviewFiles) await unlink(path.join(previews, filename));
  }
});
