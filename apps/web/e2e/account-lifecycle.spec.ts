import "dotenv/config";
import { test, expect as baseExpect, type Page } from "@playwright/test";
import pg from "pg";
import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Allow first-request compilation when this suite runs against the development server.
const expect = baseExpect.configure({ timeout: 20_000 });

test("local previews complete onboarding, recovery, password change, and invitation acceptance", async ({ browser }) => {
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
        if (link && new URL(link).pathname === route) { found = link; return true; }
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
